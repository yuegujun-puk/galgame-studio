# ============================================
# Galgame Studio - 视觉小说制作器 后端
# FastAPI + SQLite：账号（邮箱验证码）/ 项目 CRUD（按用户隔离）/
# 素材上传 / 独立 HTML 导出
# ============================================
import hashlib
import json
import os
import re
import secrets
import smtplib
import sqlite3
import time
import uuid
from email.mime.text import MIMEText
from email.header import Header
from email.utils import formataddr
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
STATIC_DIR = BASE / "static"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "studio.db"

# ---------------- SMTP（邮箱验证码发信） ----------------
# 通过环境变量配置，例如 163 邮箱：
#   SMTP_HOST=smtp.163.com  SMTP_PORT=465
#   SMTP_USER=xxx@163.com   SMTP_AUTH=邮箱设置里生成的「授权码」（不是登录密码）
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT") or 465)
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_AUTH = os.environ.get("SMTP_AUTH", "")

SESSION_COOKIE = "gs_session"
SESSION_TTL = 30 * 24 * 3600
CODE_TTL = 600          # 验证码 10 分钟
CODE_RESEND = 60        # 重发间隔
EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+(\.[\w-]+)+$")

app = FastAPI(title="Galgame Studio", version="2.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
    allow_headers=["*"], allow_credentials=True,
)

# ---------------- 数据库 ----------------

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                cover TEXT DEFAULT '',
                data TEXT NOT NULL,
                created_at REAL,
                updated_at REAL
            )"""
        )
        # 老库迁移：补 user_id 列
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(projects)")]
        if "user_id" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN user_id TEXT")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                pw_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at REAL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at REAL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS email_codes (
                email TEXT PRIMARY KEY,
                code TEXT NOT NULL,
                purpose TEXT NOT NULL,
                expires_at REAL,
                last_sent REAL
            )"""
        )


init_db()

# ---------------- 工具 ----------------

def now():
    return time.time()


def hash_pw(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 120_000).hex()


def current_user(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    with db() as conn:
        s = conn.execute("SELECT * FROM sessions WHERE token=?", (token,)).fetchone()
        if not s:
            return None
        u = conn.execute("SELECT * FROM users WHERE id=?", (s["user_id"],)).fetchone()
    return u


def require_user(request: Request):
    u = current_user(request)
    if not u:
        raise HTTPException(401, "请先登录")
    return u


def project_row_to_dict(r):
    return {
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "cover": r["cover"],
        "isPublic": r["user_id"] is None,
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
    }


def load_project(pid: str):
    with db() as conn:
        r = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    if not r:
        raise HTTPException(404, "项目不存在")
    try:
        data = json.loads(r["data"])
    except Exception:
        data = {}
    return r, data


def default_project(name: str):
    return {
        "settings": {
            "skin": "classic", "speed": 2, "autoDelay": 1600, "bgDim": 18,
            "bgBlur": 0, "moodLight": True, "kenBurns": True, "fontSize": 16,
            "badge": True, "startScene": "",
        },
        "characters": [],
        "scenes": [],
    }


def esc_html(s):
    return (
        str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace('"', "&quot;")
    )

# ---------------- 邮件 ----------------

def send_code_email(to_email: str, code: str, purpose: str):
    action = "注册" if purpose == "register" else "重置密码"
    body = (
        f"你好！\n\n你正在 Galgame Studio（视觉小说制作器）{action}账号。\n\n"
        f"验证码：{code}\n\n{CODE_TTL // 60} 分钟内有效。如果不是本人操作，请忽略本邮件。\n\n"
        f"—— Galgame Studio"
    )
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(f"【Galgame Studio】{action}验证码：{code}", "utf-8")
    msg["From"] = formataddr((str(Header("Galgame Studio", "utf-8")), SMTP_USER))
    msg["To"] = to_email
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15) as s:
        s.login(SMTP_USER, SMTP_AUTH)
        s.sendmail(SMTP_USER, [to_email], msg.as_string())

# ---------------- 账号 API ----------------

@app.get("/api/auth/me")
def auth_me(request: Request):
    u = current_user(request)
    if not u:
        return {"user": None}
    return {"user": {"id": u["id"], "email": u["email"]}}


@app.post("/api/auth/send-code")
def auth_send_code(request: Request, body: dict):
    email = str(body.get("email") or "").strip().lower()
    purpose = body.get("purpose") or "register"
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "邮箱格式不正确")
    if purpose not in ("register", "reset"):
        raise HTTPException(400, "参数错误")
    with db() as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
        if purpose == "register" and exists:
            raise HTTPException(400, "该邮箱已注册，请直接登录")
        if purpose == "reset" and not exists:
            raise HTTPException(400, "该邮箱尚未注册")
        row = conn.execute("SELECT last_sent FROM email_codes WHERE email=?", (email,)).fetchone()
        if row and now() - (row["last_sent"] or 0) < CODE_RESEND:
            raise HTTPException(429, f"发送太频繁，请 {CODE_RESEND} 秒后再试")
        code = f"{secrets.randbelow(1_000_000):06d}"
        conn.execute(
            "INSERT INTO email_codes (email,code,purpose,expires_at,last_sent) VALUES (?,?,?,?,?) "
            "ON CONFLICT(email) DO UPDATE SET code=?,purpose=?,expires_at=?,last_sent=?",
            (email, code, purpose, now() + CODE_TTL, now(),
             code, purpose, now() + CODE_TTL, now()),
        )
    if not (SMTP_HOST and SMTP_USER and SMTP_AUTH):
        raise HTTPException(503, "邮件服务未配置：请设置 SMTP_HOST / SMTP_USER / SMTP_AUTH 环境变量")
    try:
        send_code_email(email, code, purpose)
    except Exception as e:
        raise HTTPException(502, f"验证码邮件发送失败：{e}")
    return {"ok": True}


@app.post("/api/auth/register")
def auth_register(body: dict, response: Response):
    email = str(body.get("email") or "").strip().lower()
    code = str(body.get("code") or "").strip()
    password = str(body.get("password") or "")
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "邮箱格式不正确")
    if len(password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    with db() as conn:
        row = conn.execute("SELECT * FROM email_codes WHERE email=?", (email,)).fetchone()
        if not row or row["purpose"] != "register" or row["expires_at"] < now():
            raise HTTPException(400, "验证码已过期，请重新发送")
        if not secrets.compare_digest(row["code"], code):
            raise HTTPException(400, "验证码错误")
        if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            raise HTTPException(400, "该邮箱已注册，请直接登录")
        uid = uuid.uuid4().hex[:12]
        salt = secrets.token_hex(16)
        conn.execute(
            "INSERT INTO users (id,email,pw_hash,salt,created_at) VALUES (?,?,?,?,?)",
            (uid, email, hash_pw(password, salt), salt, now()),
        )
        conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
        token = secrets.token_hex(32)
        conn.execute("INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)",
                     (token, uid, now()))
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax",
                        max_age=SESSION_TTL)
    return {"ok": True, "user": {"id": uid, "email": email}}


@app.post("/api/auth/login")
def auth_login(body: dict, response: Response):
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    with db() as conn:
        u = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not u or hash_pw(password, u["salt"]) != u["pw_hash"]:
            raise HTTPException(400, "邮箱或密码错误")
        token = secrets.token_hex(32)
        conn.execute("INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)",
                     (token, u["id"], now()))
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax",
                        max_age=SESSION_TTL)
    return {"ok": True, "user": {"id": u["id"], "email": u["email"]}}


@app.post("/api/auth/reset")
def auth_reset(body: dict, response: Response):
    email = str(body.get("email") or "").strip().lower()
    code = str(body.get("code") or "").strip()
    password = str(body.get("password") or "")
    if len(password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    with db() as conn:
        u = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not u:
            raise HTTPException(400, "该邮箱尚未注册")
        row = conn.execute("SELECT * FROM email_codes WHERE email=?", (email,)).fetchone()
        if not row or row["purpose"] != "reset" or row["expires_at"] < now():
            raise HTTPException(400, "验证码已过期，请重新发送")
        if not secrets.compare_digest(row["code"], code):
            raise HTTPException(400, "验证码错误")
        salt = secrets.token_hex(16)
        conn.execute("UPDATE users SET pw_hash=?, salt=? WHERE id=?",
                     (hash_pw(password, salt), salt, u["id"]))
        conn.execute("DELETE FROM email_codes WHERE email=?", (email,))
        token = secrets.token_hex(32)
        conn.execute("INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)",
                     (token, u["id"], now()))
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax",
                        max_age=SESSION_TTL)
    return {"ok": True, "user": {"id": u["id"], "email": email}}


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}

# ---------------- 项目 API（按用户隔离） ----------------
# user_id IS NULL 的项目 = 公开示例（所有人可见、只读）

@app.get("/api/projects")
def list_projects(request: Request):
    u = current_user(request)
    with db() as conn:
        if u:
            rows = conn.execute(
                "SELECT * FROM projects WHERE user_id=? OR user_id IS NULL ORDER BY updated_at DESC",
                (u["id"],),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM projects WHERE user_id IS NULL ORDER BY updated_at DESC"
            ).fetchall()
    return [project_row_to_dict(r) for r in rows]


@app.post("/api/projects")
def create_project(request: Request, body: dict):
    u = require_user(request)  # 游客作品存本地，云端必须有归属
    pid = uuid.uuid4().hex[:12]
    name = str(body.get("name") or "未命名作品").strip()[:60] or "未命名作品"
    desc = str(body.get("description") or "")[:500]
    data = default_project(name)
    sid = uuid.uuid4().hex[:10]
    data["settings"]["startScene"] = sid
    data["scenes"].append({"id": sid, "name": "开场", "bg": "", "bgm": "", "nodes": []})
    t = now()
    with db() as conn:
        conn.execute(
            "INSERT INTO projects (id,user_id,name,description,cover,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (pid, u["id"], name, desc, "", json.dumps(data, ensure_ascii=False), t, t),
        )
    return {"id": pid, "name": name, "description": desc, "cover": "",
            "isPublic": False, "createdAt": t, "updatedAt": t}


@app.get("/api/projects/{pid}")
def get_project(pid: str, request: Request):
    r, data = load_project(pid)
    u = current_user(request)
    if r["user_id"] is not None and (not u or u["id"] != r["user_id"]):
        raise HTTPException(403, "没有权限访问该作品")
    return {**project_row_to_dict(r), "data": data}


@app.put("/api/projects/{pid}")
def save_project(pid: str, request: Request, body: dict):
    u = require_user(request)
    r, _old = load_project(pid)
    if r["user_id"] != u["id"]:
        raise HTTPException(403, "只能保存自己的作品（公开示例请先复制一份）")
    data = body.get("data")
    if not isinstance(data, dict):
        raise HTTPException(400, "缺少 data 字段")
    name = str(body.get("name") or r["name"]).strip()[:60] or r["name"]
    desc = str(body.get("description") if body.get("description") is not None else r["description"])[:500]
    cover = str(body.get("cover") if body.get("cover") is not None else r["cover"])
    with db() as conn:
        conn.execute(
            "UPDATE projects SET name=?, description=?, cover=?, data=?, updated_at=? WHERE id=?",
            (name, desc, cover, json.dumps(data, ensure_ascii=False), now(), pid),
        )
    return {"ok": True, "updatedAt": now()}


@app.delete("/api/projects/{pid}")
def delete_project(pid: str, request: Request):
    u = require_user(request)
    with db() as conn:
        cur = conn.execute("DELETE FROM projects WHERE id=? AND user_id=?", (pid, u["id"]))
    if cur.rowcount == 0:
        raise HTTPException(403, "只能删除自己的作品")
    return {"ok": True}


@app.post("/api/projects/{pid}/duplicate")
def duplicate_project(pid: str, request: Request):
    u = require_user(request)  # 复制永远落到自己名下
    r, data = load_project(pid)
    pid2 = uuid.uuid4().hex[:12]
    name = (r["name"] + " 副本")[:60]
    t = now()
    with db() as conn:
        conn.execute(
            "INSERT INTO projects (id,user_id,name,description,cover,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (pid2, u["id"], name, r["description"], r["cover"],
             json.dumps(data, ensure_ascii=False), t, t),
        )
    return {"id": pid2, "name": name, "isPublic": False}

# ---------------- 导出 ----------------

def absolutize(obj, base):
    if isinstance(obj, dict):
        return {k: absolutize(v, base) for k, v in obj.items()}
    if isinstance(obj, list):
        return [absolutize(v, base) for v in obj]
    if isinstance(obj, str) and obj.startswith('/uploads/'):
        return base + obj
    return obj


def build_export(name: str, description: str, data: dict, base: str) -> str:
    template = (STATIC_DIR / "export_template.html").read_text(encoding="utf-8")
    player_js = (STATIC_DIR / "player.js").read_text(encoding="utf-8")
    player_css = (STATIC_DIR / "vn.css").read_text(encoding="utf-8")
    payload = json.dumps(
        {"project": data, "meta": {"name": name, "description": description}},
        ensure_ascii=False,
    ).replace("</", "<\\/")
    safe_js = player_js.replace("</script", "<\\/script").replace("<!--", "<\\!--")
    return (
        template.replace("/*__VN_CSS__*/", player_css)
        .replace("//__PLAYER_JS__", safe_js)
        .replace("__PROJECT_JSON__", payload)
        .replace("__TITLE__", esc_html(name))
    )


@app.get("/api/projects/{pid}/export")
def export_project(pid: str, request: Request):
    r, data = load_project(pid)
    u = current_user(request)
    if r["user_id"] is not None and (not u or u["id"] != r["user_id"]):
        raise HTTPException(403, "没有权限导出该作品")
    data = absolutize(data, str(request.base_url).rstrip('/'))
    html = build_export(r["name"], r["description"], data, str(request.base_url).rstrip('/'))
    from urllib.parse import quote
    fname = re.sub(r'[\\/:*?"<>|\r\n]+', "_", r["name"])[:50] or "galgame"
    return Response(
        content=html, media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=\"game.html\"; filename*=UTF-8''" + quote(fname) + ".html"},
    )


@app.post("/api/export")
def export_anonymous(request: Request, body: dict):
    """游客导出：项目数据由前端本地存储直传，不经云端保存"""
    data = body.get("data")
    if not isinstance(data, dict):
        raise HTTPException(400, "缺少 data 字段")
    name = str(body.get("name") or "未命名作品")[:60]
    desc = str(body.get("description") or "")[:500]
    data = absolutize(data, str(request.base_url).rstrip('/'))
    html = build_export(name, desc, data, str(request.base_url).rstrip('/'))
    return Response(content=html, media_type="text/html; charset=utf-8")

# ---------------- 素材上传 ----------------

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp",
               ".mp3", ".ogg", ".wav", ".m4a", ".mp4", ".webm"}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        ext = ".bin"
    fname = f"{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / fname
    size = 0
    with open(path, "wb") as f:
        while True:
            chunk = await file.read(1024 * 512)
            if not chunk:
                break
            size += len(chunk)
            f.write(chunk)
    if size > 30 * 1024 * 1024:
        path.unlink(missing_ok=True)
        raise HTTPException(413, "文件超过 30MB 限制")
    return {"ok": True, "url": f"/uploads/{fname}", "size": size, "name": file.filename}

# ---------------- 静态资源 ----------------

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT") or 3000))
