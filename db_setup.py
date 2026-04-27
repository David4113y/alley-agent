"""
Database setup — SQLite with optional Turso cloud sync via HTTP API.
Uses standard-library sqlite3 for maximum compatibility.
"""
import os
import sqlite3
import bcrypt
import httpx

_conn = None
_turso_url = None
_turso_token = None


def get_db():
    """Return a SQLite connection. Uses local file; syncs to Turso via HTTP if configured."""
    global _conn, _turso_url, _turso_token
    if _conn is None:
        _conn = sqlite3.connect("local.db", check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
        url = os.getenv("TURSO_DATABASE_URL", "")
        token = os.getenv("TURSO_AUTH_TOKEN", "")
        if url and token:
            _turso_url = url.replace("libsql://", "https://")
            _turso_token = token
    return _conn


def turso_sync(sql: str, params: tuple = ()):
    """Optionally replicate a write to Turso cloud (fire-and-forget)."""
    if not _turso_url or not _turso_token:
        return
    try:
        body = {"statements": [{"q": sql, "params": list(params)}]}
        httpx.post(
            f"{_turso_url}/v2/pipeline",
            json={"requests": [{"type": "execute", "stmt": {"sql": sql, "args": [{"type": "text", "value": str(p)} for p in params]}}]},
            headers={"Authorization": f"Bearer {_turso_token}"},
            timeout=5,
        )
    except Exception:
        pass


def init_db():
    db = get_db()
    cursor = db.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    UNIQUE NOT NULL,
            email         TEXT    UNIQUE,
            password_hash TEXT    NOT NULL,
            role          TEXT    NOT NULL DEFAULT 'user',
            created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
            is_active     INTEGER NOT NULL DEFAULT 1,
            free_prompt_used INTEGER NOT NULL DEFAULT 0,
            has_seen_store INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS memberships (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id        INTEGER NOT NULL REFERENCES users(id),
            plan           TEXT    NOT NULL,
            amount_cents   INTEGER NOT NULL,
            currency       TEXT    NOT NULL DEFAULT 'USD',
            payment_method TEXT    NOT NULL,
            payment_ref    TEXT,
            status         TEXT    NOT NULL DEFAULT 'pending',
            starts_at      TEXT,
            expires_at     TEXT,
            created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id),
            title         TEXT    NOT NULL DEFAULT 'New Chat',
            summary       TEXT,
            created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL REFERENCES conversations(id),
            role            TEXT    NOT NULL,
            content         TEXT    NOT NULL,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS support_tickets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id),
            subject    TEXT    NOT NULL,
            message    TEXT    NOT NULL,
            status     TEXT    NOT NULL DEFAULT 'open',
            admin_reply TEXT,
            created_at TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_memories (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id),
            memory_text TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS agent_tasks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            task_type   TEXT    NOT NULL,
            description TEXT    NOT NULL,
            status      TEXT    NOT NULL DEFAULT 'pending',
            result      TEXT,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS store_products (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            description TEXT,
            price_cents INTEGER NOT NULL,
            category    TEXT    NOT NULL DEFAULT 'agent_service',
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS store_purchases (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            product_id  INTEGER NOT NULL REFERENCES store_products(id),
            amount_cents INTEGER NOT NULL,
            payment_method TEXT NOT NULL,
            payment_ref TEXT,
            status      TEXT    NOT NULL DEFAULT 'pending',
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS arcade_games (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL,
            description TEXT,
            html_content TEXT   NOT NULL,
            author_id   INTEGER REFERENCES users(id),
            is_approved INTEGER NOT NULL DEFAULT 0,
            play_count  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
    """)

    # Seed admin account
    admin_user = os.getenv("ADMIN_USERNAME", "DAVIDALLEY")
    admin_pass = os.getenv("ADMIN_PASSWORD", "Passwerd1")

    existing = cursor.execute(
        "SELECT id FROM users WHERE username = ?", (admin_user,)
    ).fetchone()

    if not existing:
        pw_hash = bcrypt.hashpw(admin_pass.encode(), bcrypt.gensalt(12)).decode()
        cursor.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
            (admin_user, pw_hash),
        )
        db.commit()
        print(f"Admin account '{admin_user}' created.")

    # Seed default store products
    existing_products = cursor.execute("SELECT COUNT(*) FROM store_products").fetchone()[0]
    if existing_products == 0:
        products = [
            ("AI Agent - Basic", "Personal AI agent that handles tasks for you", 2500, "agent_service"),
            ("AI Agent - Pro", "Advanced agent with multi-step task execution", 5000, "agent_service"),
            ("AI Agent - Enterprise", "Full autonomous agent with priority processing", 10000, "agent_service"),
            ("Code Review Service", "AI-powered code review and suggestions", 1500, "agent_service"),
            ("Research Assistant", "Deep research on any topic with citations", 2000, "agent_service"),
            ("Content Writer", "AI content generation for blogs, social, etc.", 2000, "agent_service"),
        ]
        for name, desc, price, cat in products:
            cursor.execute(
                "INSERT INTO store_products (name, description, price_cents, category) VALUES (?, ?, ?, ?)",
                (name, desc, price, cat),
            )
        db.commit()

    # Seed default arcade games
    existing_games = cursor.execute("SELECT COUNT(*) FROM arcade_games").fetchone()[0]
    if existing_games == 0:
        _seed_default_games(db)


def _seed_default_games(db):
    """Seed the two original arcade games."""
    alley_agents_html = """<canvas id="gc" width="800" height="400" style="border:2px solid #58a6ff;background:#0d1117;display:block;margin:0 auto;"></canvas>
<script>
const c=document.getElementById('gc'),x=c.getContext('2d');
let p={x:50,y:350,w:30,h:30,vy:0,jumping:false,color:'#58a6ff'},
    platforms=[{x:0,y:380,w:800,h:20},{x:200,y:300,w:100,h:15},{x:400,y:250,w:120,h:15},{x:600,y:200,w:100,h:15}],
    coins=[{x:230,y:270,r:8,taken:false},{x:440,y:220,r:8,taken:false},{x:640,y:170,r:8,taken:false}],
    score=0,gravity=0.6,keys={};
document.addEventListener('keydown',e=>keys[e.key]=true);
document.addEventListener('keyup',e=>keys[e.key]=false);
function update(){
    if(keys['ArrowLeft']||keys['a'])p.x-=4;
    if(keys['ArrowRight']||keys['d'])p.x+=4;
    if((keys['ArrowUp']||keys[' ']||keys['w'])&&!p.jumping){p.vy=-12;p.jumping=true;}
    p.vy+=gravity;p.y+=p.vy;
    platforms.forEach(pl=>{if(p.vy>0&&p.y+p.h>pl.y&&p.y+p.h<pl.y+pl.h+10&&p.x+p.w>pl.x&&p.x<pl.x+pl.w){p.y=pl.y-p.h;p.vy=0;p.jumping=false;}});
    coins.forEach(co=>{if(!co.taken&&Math.abs(p.x+15-co.x)<20&&Math.abs(p.y+15-co.y)<20){co.taken=true;score+=10;}});
    if(p.x<0)p.x=0;if(p.x>770)p.x=770;
}
function draw(){
    x.fillStyle='#0d1117';x.fillRect(0,0,800,400);
    platforms.forEach(pl=>{x.fillStyle='#30363d';x.fillRect(pl.x,pl.y,pl.w,pl.h);});
    coins.forEach(co=>{if(!co.taken){x.beginPath();x.arc(co.x,co.y,co.r,0,Math.PI*2);x.fillStyle='#d29922';x.fill();}});
    x.fillStyle=p.color;x.fillRect(p.x,p.y,p.w,p.h);
    x.fillStyle='#e6edf3';x.font='16px monospace';x.fillText('Score: '+score,10,25);
    x.fillStyle='#8b949e';x.font='12px monospace';x.fillText('Arrow keys / WASD to move, Space to jump',200,395);
}
function loop(){update();draw();requestAnimationFrame(loop);}
loop();
</script>"""

    eoe_html = """<canvas id="gc" width="800" height="400" style="border:2px solid #a371f7;background:#0d1117;display:block;margin:0 auto;"></canvas>
<script>
const c=document.getElementById('gc'),x=c.getContext('2d');
let player={x:400,y:200,r:15,hp:100,color:'#a371f7'},
    enemies=[],bullets=[],score=0,wave=1,spawnTimer=0,keys={},mouseX=400,mouseY=200;
document.addEventListener('keydown',e=>keys[e.key]=true);
document.addEventListener('keyup',e=>keys[e.key]=false);
c.addEventListener('mousemove',e=>{const r=c.getBoundingClientRect();mouseX=e.clientX-r.left;mouseY=e.clientY-r.top;});
c.addEventListener('click',()=>{const dx=mouseX-player.x,dy=mouseY-player.y,d=Math.sqrt(dx*dx+dy*dy);bullets.push({x:player.x,y:player.y,vx:dx/d*8,vy:dy/d*8,r:4});});
function spawn(){enemies.push({x:Math.random()*800,y:Math.random()<0.5?-20:420,r:12,hp:20+wave*5,speed:1+wave*0.2,color:'#f85149'});}
function update(){
    if(keys['a']||keys['ArrowLeft'])player.x-=3;if(keys['d']||keys['ArrowRight'])player.x+=3;
    if(keys['w']||keys['ArrowUp'])player.y-=3;if(keys['s']||keys['ArrowDown'])player.y+=3;
    player.x=Math.max(15,Math.min(785,player.x));player.y=Math.max(15,Math.min(385,player.y));
    spawnTimer++;if(spawnTimer>60){spawn();spawnTimer=0;}
    enemies.forEach(e=>{const dx=player.x-e.x,dy=player.y-e.y,d=Math.sqrt(dx*dx+dy*dy);e.x+=dx/d*e.speed;e.y+=dy/d*e.speed;if(d<player.r+e.r)player.hp-=0.5;});
    bullets.forEach(b=>{b.x+=b.vx;b.y+=b.vy;});
    bullets=bullets.filter(b=>b.x>0&&b.x<800&&b.y>0&&b.y<400);
    bullets.forEach(b=>{enemies.forEach(e=>{const d=Math.sqrt((b.x-e.x)**2+(b.y-e.y)**2);if(d<b.r+e.r){e.hp-=25;b.r=0;}});});
    enemies=enemies.filter(e=>{if(e.hp<=0){score+=10;return false;}return true;});
    if(score>0&&score%100===0)wave=Math.floor(score/100)+1;
}
function draw(){
    x.fillStyle='#0d1117';x.fillRect(0,0,800,400);
    enemies.forEach(e=>{x.beginPath();x.arc(e.x,e.y,e.r,0,Math.PI*2);x.fillStyle=e.color;x.fill();});
    bullets.forEach(b=>{x.beginPath();x.arc(b.x,b.y,b.r,0,Math.PI*2);x.fillStyle='#58a6ff';x.fill();});
    x.beginPath();x.arc(player.x,player.y,player.r,0,Math.PI*2);x.fillStyle=player.color;x.fill();
    x.fillStyle='#e6edf3';x.font='14px monospace';x.fillText('HP: '+Math.max(0,Math.round(player.hp))+'  Score: '+score+'  Wave: '+wave,10,25);
    x.fillStyle='#8b949e';x.font='11px monospace';x.fillText('WASD to move, Click to shoot',280,395);
    if(player.hp<=0){x.fillStyle='rgba(0,0,0,0.7)';x.fillRect(0,0,800,400);x.fillStyle='#f85149';x.font='36px monospace';x.fillText('GAME OVER',290,190);x.fillStyle='#e6edf3';x.font='18px monospace';x.fillText('Score: '+score,340,230);}
}
function loop(){if(player.hp>0)update();draw();requestAnimationFrame(loop);}
loop();
</script>"""

    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO arcade_games (title, description, html_content, is_approved, author_id) VALUES (?, ?, ?, 1, NULL)",
        ("Alley Agents", "Classic platformer — collect coins and jump across platforms!", alley_agents_html),
    )
    cursor.execute(
        "INSERT INTO arcade_games (title, description, html_content, is_approved, author_id) VALUES (?, ?, ?, 1, NULL)",
        ("Echoes of Eternity", "Survive endless waves of enemies in this arena shooter!", eoe_html),
    )
    db.commit()
