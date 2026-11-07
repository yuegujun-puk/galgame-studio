// ============================================
// Galgame Studio · 编辑器逻辑（v2 账号版）
// - 登录用户：作品存云端，按账号隔离
// - 游客：作品存本机 localStorage，不上云
// - 公开示例：所有人可见、只读，可一键复制到自己名下
// ============================================
(function () {
    'use strict';

    const $ = (s, p) => (p || document).querySelector(s);
    const $$ = (s, p) => Array.from((p || document).querySelectorAll(s));
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

    const EM = window.VNPlayer.EMOTION_META;
    const EM_IDS = window.VNPlayer.EMOTION_IDS;

    // ---------------- 全局状态 ----------------
    let user = null;         // {id,email} 或 null（游客）
    let cur = null;          // 当前项目完整数据
    let curIsLocal = false;  // 当前项目是否本地存储（游客）
    let curIsPublic = false; // 公开示例（只读）
    let curSceneId = null;
    let editingNodeIdx = -1;
    let saveTimer = null;
    let dirty = false;

    // ---------------- 工具 ----------------
    function toast(msg, icon) {
        const box = $('#toast-box');
        const t = document.createElement('div');
        t.className = 'toast';
        t.innerHTML = `<i class="${icon || 'ri-information-line'}"></i><span>${esc(msg)}</span>`;
        box.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2400);
        setTimeout(() => t.remove(), 2800);
    }

    async function api(path, opts) {
        const res = await fetch('/api' + path, opts);
        if (!res.ok) {
            let msg = res.status;
            try { msg = (await res.json()).detail || msg; } catch (e) {}
            const err = new Error(msg);
            err.status = res.status;
            throw err;
        }
        return res.json();
    }
    const jpost = (path, body) => api(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });

    async function uploadFile(file) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        if (!res.ok) throw new Error('上传失败');
        return (await res.json()).url;
    }

    async function downloadUrl(url, filename) {
        const res = await fetch(url);
        if (!res.ok) throw new Error('导出失败');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || 'galgame.html';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    function fmtTime(ts) {
        if (!ts) return '';
        const d = new Date(ts * 1000);
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    // ---------------- 弹窗 ----------------
    function openModal(title, bodyHTML) {
        $('#modal-title').textContent = title;
        $('#modal-body').innerHTML = bodyHTML;
        $('#modal-mask').hidden = false;
    }
    function closeModal() { $('#modal-mask').hidden = true; }

    // ================= 账号 =================
    async function refreshUser() {
        try {
            const r = await api('/auth/me');
            user = r.user;
        } catch (e) { user = null; }
        renderAccount();
    }

    function renderAccount() {
        const html = user
            ? `<span class="acc-email" title="${esc(user.email)}"><i class="ri-user-3-fill"></i> ${esc(user.email)}</span>
               <button class="btn btn-small" id="btn-logout" title="退出登录"><i class="ri-logout-box-line"></i> 退出</button>`
            : `<span class="acc-guest-tip" title="游客作品只保存在本设备浏览器里"><i class="ri-ghost-line"></i> 游客模式</span>
               <button class="btn btn-small btn-gold" id="btn-login"><i class="ri-login-circle-line"></i> 登录 / 注册</button>`;
        $('#lib-account').innerHTML = html;
        $('#ed-account').innerHTML = html;
        const bind = () => {
            const lo = $('#btn-logout');
            if (lo) lo.onclick = doLogout;
            const li = $('#btn-login');
            if (li) li.onclick = openAuthModal;
        };
        bind();
    }

    async function doLogout() {
        await jpost('/auth/logout');
        user = null;
        renderAccount();
        toast('已退出登录（作品仍安全保存在你的账号里）', 'ri-logout-box-line');
        loadLibrary();
    }

    function openAuthModal(mode) {
        mode = mode || 'login';
        const tabs = `
            <div class="auth-tabs">
                <button data-m="login" class="${mode === 'login' ? 'on' : ''}">登录</button>
                <button data-m="register" class="${mode === 'register' ? 'on' : ''}">邮箱注册</button>
                <button data-m="reset" class="${mode === 'reset' ? 'on' : ''}">找回密码</button>
            </div>`;
        let form = '';
        if (mode === 'login') {
            form = `
                <div class="form-row"><label>邮箱</label><input type="text" id="au-email" class="grow" placeholder="you@example.com"></div>
                <div class="form-row"><label>密码</label><input type="password" id="au-pw" class="grow" placeholder="至少 6 位"></div>
                <button class="btn btn-gold" id="au-submit" style="width:100%;justify-content:center;"><i class="ri-login-circle-line"></i> 登录</button>
                <div class="form-hint">登录后作品保存到你的账号，只有登录你的邮箱才能看到。</div>`;
        } else if (mode === 'register') {
            form = `
                <div class="form-row"><label>邮箱</label><input type="text" id="au-email" class="grow" placeholder="用于接收验证码"></div>
                <div class="form-row"><label>验证码</label><input type="text" id="au-code" class="grow" maxlength="6" placeholder="6 位数字">
                    <button class="btn" id="au-send">发送验证码</button></div>
                <div class="form-row"><label>设置密码</label><input type="password" id="au-pw" class="grow" placeholder="至少 6 位"></div>
                <button class="btn btn-gold" id="au-submit" style="width:100%;justify-content:center;"><i class="ri-user-add-line"></i> 注册并登录</button>
                <div class="form-hint">验证码发到你的邮箱（10 分钟内有效）。游客模式下创建的本地作品不会自动上传。</div>`;
        } else {
            form = `
                <div class="form-row"><label>邮箱</label><input type="text" id="au-email" class="grow" placeholder="注册时使用的邮箱"></div>
                <div class="form-row"><label>验证码</label><input type="text" id="au-code" class="grow" maxlength="6" placeholder="6 位数字">
                    <button class="btn" id="au-send">发送验证码</button></div>
                <div class="form-row"><label>新密码</label><input type="password" id="au-pw" class="grow" placeholder="至少 6 位"></div>
                <button class="btn btn-gold" id="au-submit" style="width:100%;justify-content:center;"><i class="ri-key-line"></i> 重置密码并登录</button>`;
        }
        openModal('账号', tabs + `<div class="auth-form">${form}</div>`);

        $$('.auth-tabs button').forEach(b => b.onclick = () => openAuthModal(b.dataset.m));

        const sendBtn = $('#au-send');
        if (sendBtn) sendBtn.onclick = async () => {
            const email = $('#au-email').value.trim();
            if (!email) return toast('请先填写邮箱', 'ri-error-warning-line');
            sendBtn.disabled = true;
            try {
                await jpost('/auth/send-code', { email, purpose: mode });
                toast('验证码已发送，请查收邮箱（注意垃圾箱）', 'ri-mail-send-line');
                let sec = 60;
                const tick = setInterval(() => {
                    sec--;
                    if (sec <= 0) { clearInterval(tick); sendBtn.disabled = false; sendBtn.textContent = '发送验证码'; }
                    else sendBtn.textContent = `${sec}s`;
                }, 1000);
            } catch (e) {
                sendBtn.disabled = false;
                toast(e.message, 'ri-error-warning-line');
            }
        };

        const submit = $('#au-submit');
        if (submit) submit.onclick = async () => {
            const email = $('#au-email').value.trim();
            const pw = $('#au-pw').value;
            try {
                if (mode === 'login') {
                    await jpost('/auth/login', { email, password: pw });
                } else if (mode === 'register') {
                    await jpost('/auth/register', { email, code: $('#au-code').value.trim(), password: pw });
                } else {
                    await jpost('/auth/reset', { email, code: $('#au-code').value.trim(), password: pw });
                }
                await refreshUser();
                closeModal();
                toast(`欢迎，${user.email}`, 'ri-emotion-happy-line');
                loadLibrary();
            } catch (e) {
                toast(e.message, 'ri-error-warning-line');
            }
        };
    }

    // ================= 存储层：云端 / 本地 =================
    const LS_KEY = 'gs_local_projects_v1';

    const ServerStore = {
        isLocal: false,
        async list() { return api('/projects'); },
        async create(name, desc) { return jpost('/projects', { name, description: desc }); },
        async get(id) { return api('/projects/' + id); },
        async save(p) {
            return api('/projects/' + p.id, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: p.name, description: p.description, cover: p.cover, data: p.data })
            });
        },
        async del(id) { return api('/projects/' + id, { method: 'DELETE' }); },
        async dup(id) { return jpost('/projects/' + id + '/duplicate'); },
        async export(p) { return downloadUrl('/api/projects/' + p.id + '/export', (p.name || 'galgame') + '.html'); }
    };

    const LocalStore = {
        isLocal: true,
        _all() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch (e) { return []; } },
        _saveAll(a) { localStorage.setItem(LS_KEY, JSON.stringify(a)); },
        async list() {
            return this._all().map(p => ({
                id: p.id, name: p.name, description: p.description, cover: p.cover,
                isPublic: false, isLocal: true, updatedAt: p.updatedAt
            }));
        },
        async create(name, desc) {
            const all = this._all();
            const sid = uid();
            const p = {
                id: 'L' + uid(), name: name || '未命名作品', description: desc || '', cover: '',
                isPublic: false, isLocal: true,
                createdAt: Date.now() / 1000, updatedAt: Date.now() / 1000,
                data: {
                    settings: { skin: 'classic', speed: 2, autoDelay: 1600, bgDim: 18, bgBlur: 0, moodLight: true, kenBurns: true, fontSize: 16, badge: true, startScene: sid },
                    characters: [],
                    scenes: [{ id: sid, name: '开场', bg: '', bgm: '', nodes: [] }]
                }
            };
            all.push(p); this._saveAll(all);
            return { id: p.id, name: p.name, description: p.description, cover: p.cover, isPublic: false, isLocal: true, updatedAt: p.updatedAt };
        },
        async get(id) {
            const p = this._all().find(x => x.id === id);
            if (!p) throw new Error('本地作品不存在');
            return JSON.parse(JSON.stringify(p));
        },
        async save(p) {
            const all = this._all();
            const i = all.findIndex(x => x.id === p.id);
            if (i < 0) throw new Error('本地作品不存在');
            all[i] = { ...all[i], name: p.name, description: p.description, cover: p.cover, data: p.data, updatedAt: Date.now() / 1000 };
            this._saveAll(all);
            return { ok: true };
        },
        async del(id) {
            this._saveAll(this._all().filter(x => x.id !== id));
            return { ok: true };
        },
        async dup(id) {
            const p = this._all().find(x => x.id === id);
            if (!p) throw new Error('本地作品不存在');
            const copy = JSON.parse(JSON.stringify(p));
            copy.id = 'L' + uid();
            copy.name = (p.name + ' 副本').slice(0, 60);
            copy.updatedAt = Date.now() / 1000;
            const all = this._all(); all.push(copy); this._saveAll(all);
            return { id: copy.id, name: copy.name };
        },
        async export(p) {
            const res = await fetch('/api/export', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: p.name, description: p.description, data: p.data })
            });
            if (!res.ok) throw new Error('导出失败');
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = (p.name || 'galgame') + '.html';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }
    };

    // 游客把云端公开作品复制到本地
    async function copyPublicToLocal(pid) {
        const p = await ServerStore.get(pid);
        const all = LocalStore._all();
        const copy = {
            id: 'L' + uid(), name: (p.name + ' 副本').slice(0, 60),
            description: p.description || '', cover: p.cover || '',
            isPublic: false, isLocal: true, createdAt: Date.now() / 1000, updatedAt: Date.now() / 1000,
            data: p.data
        };
        all.push(copy); LocalStore._saveAll(all);
        return { id: copy.id, name: copy.name, isLocal: true };
    }

    // ================= 项目库 =================
    async function loadLibrary() {
        let serverList = [];
        try { serverList = await ServerStore.list(); }
        catch (e) { toast('云端列表加载失败：' + e.message, 'ri-error-warning-line'); }
        const localList = user ? [] : await LocalStore.list();

        const mine = user ? serverList.filter(p => !p.isPublic) : localList;
        const pubs = serverList.filter(p => p.isPublic);

        const card = (p, kind) => `
            <div class="proj-card" data-id="${p.id}" data-kind="${kind}">
                <div class="proj-cover" ${p.cover ? `style="background-image:url('${esc(p.cover)}')"` : ''}>
                    ${p.cover ? '' : '<i class="ri-gamepad-line"></i>'}
                    ${kind === 'pub' ? '<span class="pub-tag"><i class="ri-global-line"></i> 公开示例</span>' : ''}
                    ${kind === 'local' ? '<span class="local-tag"><i class="ri-computer-line"></i> 本设备</span>' : ''}
                </div>
                <div class="proj-info">
                    <div class="proj-name">${esc(p.name)}</div>
                    <div class="proj-desc">${esc(p.description || '（还没有简介）')}</div>
                    <div class="proj-meta">
                        <span><i class="ri-time-line"></i> ${fmtTime(p.updatedAt)}</span>
                        <span class="spacer"></span>
                        ${kind === 'pub'
                            ? `<button title="${user ? '复制到我的作品' : '复制到本设备'}" data-act="copy"><i class="ri-file-copy-line"></i></button>
                               <button title="导出 HTML" data-act="export"><i class="ri-download-2-line"></i></button>`
                            : `<button title="复制" data-act="dup"><i class="ri-file-copy-line"></i></button>
                               <button title="导出 HTML" data-act="export"><i class="ri-download-2-line"></i></button>
                               <button class="del" title="删除" data-act="del"><i class="ri-delete-bin-line"></i></button>`}
                    </div>
                </div>
            </div>`;

        let html = '';
        if (mine.length) {
            html += `<div class="lib-section-title"><i class="${user ? 'ri-cloud-line' : 'ri-computer-line'}"></i> ${user ? '我的作品' : '本设备上的作品（游客数据仅存此浏览器）'}</div>
                     <div class="lib-grid">${mine.map(p => card(p, user ? 'mine' : 'local')).join('')}</div>`;
        }
        if (pubs.length) {
            html += `<div class="lib-section-title"><i class="ri-global-line"></i> 公开示例 <span class="lib-sub">只读，可复制一份变成自己的</span></div>
                     <div class="lib-grid">${pubs.map(p => card(p, 'pub')).join('')}</div>`;
        }
        $('#project-grid').innerHTML = html;
        $('#lib-empty').hidden = !!(mine.length || pubs.length);
        if (!mine.length && !pubs.length) $('#project-grid').innerHTML = '';

        $$('.proj-card').forEach(el => {
            const id = el.dataset.id, kind = el.dataset.kind;
            el.addEventListener('click', async (e) => {
                const btn = e.target.closest('button[data-act]');
                const act = btn ? btn.dataset.act : 'open';
                e.stopPropagation();
                try {
                    if (act === 'open') {
                        if (kind === 'local') openEditor(id, { local: true });
                        else openEditor(id);
                    } else if (act === 'del') {
                        const st = kind === 'local' ? LocalStore : ServerStore;
                        const p = mine.find(x => x.id === id);
                        if (!confirm(`确定删除作品《${p ? p.name : ''}》？${kind === 'local' ? '本地数据无法恢复。' : '此操作不可恢复。'}`)) return;
                        await st.del(id);
                        toast('已删除', 'ri-delete-bin-line');
                        loadLibrary();
                    } else if (act === 'dup') {
                        const st = kind === 'local' ? LocalStore : ServerStore;
                        await st.dup(id);
                        toast('已复制副本', 'ri-file-copy-line');
                        loadLibrary();
                    } else if (act === 'copy') {
                        if (user) { await ServerStore.dup(id); toast('已复制到「我的作品」', 'ri-file-copy-line'); }
                        else { await copyPublicToLocal(id); toast('已复制到本设备（游客）', 'ri-file-copy-line'); }
                        loadLibrary();
                    } else if (act === 'export') {
                        toast('正在生成导出文件…', 'ri-download-line');
                        if (kind === 'local') {
                            const p = await LocalStore.get(id);
                            await LocalStore.export(p);
                        } else {
                            await downloadUrl('/api/projects/' + id + '/export', 'galgame.html');
                        }
                    }
                } catch (err) {
                    toast(err.message, 'ri-error-warning-line');
                }
            });
        });
    }

    async function newProject() {
        openModal('新建作品', `
            <div class="form-row"><label>作品名</label><input type="text" id="np-name" class="grow" placeholder="例如：星空下的约定" maxlength="60"></div>
            <div class="form-row"><label>简介</label><input type="text" id="np-desc" class="grow" placeholder="一句话介绍你的故事（可选）" maxlength="200"></div>
            <div class="form-hint">${user ? '将保存到你的账号，仅你可见。' : '当前是游客模式：作品只保存在本设备浏览器。注册登录后云端保存、换设备不丢。'}</div>
            <div style="display:flex;justify-content:flex-end;gap:10px;">
                <button class="btn" id="np-cancel">取消</button>
                <button class="btn btn-gold" id="np-ok"><i class="ri-add-line"></i> 创建</button>
            </div>`);
        const doCreate = async () => {
            const name = $('#np-name').value.trim() || '未命名作品';
            const desc = $('#np-desc').value.trim();
            try {
                const st = user ? ServerStore : LocalStore;
                const p = await st.create(name, desc);
                closeModal();
                toast('作品已创建', 'ri-check-line');
                if (st.isLocal) openEditor(p.id, { local: true });
                else openEditor(p.id);
            } catch (e) { toast(e.message, 'ri-error-warning-line'); }
        };
        $('#np-ok').onclick = doCreate;
        $('#np-cancel').onclick = closeModal;
        $('#np-name').focus();
        $('#np-name').addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
    }

    // ================= 编辑器 =================
    async function openEditor(pid, opts) {
        opts = opts || {};
        const st = opts.local ? LocalStore : ServerStore;
        cur = await st.get(pid);
        curIsLocal = st.isLocal;
        curIsPublic = !st.isLocal && !!cur.isPublic;
        if (!cur.data.scenes || !cur.data.scenes.length) {
            const sid = uid();
            cur.data.settings = cur.data.settings || {};
            cur.data.settings.startScene = cur.data.settings.startScene || sid;
            cur.data.scenes = [{ id: sid, name: '开场', bg: '', bgm: '', nodes: [] }];
        }
        if (!cur.data.settings.startScene || !cur.data.scenes.find(s => s.id === cur.data.settings.startScene)) {
            cur.data.settings.startScene = cur.data.scenes[0].id;
        }
        curSceneId = cur.data.settings.startScene;
        editingNodeIdx = -1;
        dirty = false;
        $('#page-library').hidden = true;
        $('#page-editor').hidden = false;
        $('#ed-title').value = cur.name;
        $('#ed-title').disabled = curIsPublic;
        setSaveState(curIsPublic ? '公开示例 · 只读' : '已保存');
        const badge = $('#ed-mode-badge');
        badge.hidden = !(curIsPublic || curIsLocal);
        badge.className = 'ed-mode-badge ' + (curIsPublic ? 'b-pub' : 'b-local');
        badge.innerHTML = curIsPublic
            ? '<i class="ri-global-line"></i> 公开示例 · 只读，复制后可编辑'
            : '<i class="ri-computer-line"></i> 游客作品 · 仅存本设备';
        renderScenes();
        renderNodes();
    }

    function setSaveState(txt, saving) {
        const el = $('#ed-save-state');
        el.textContent = txt;
        el.classList.toggle('saving', !!saving);
    }

    function markDirty() {
        if (curIsPublic) { toast('公开示例不可直接编辑，请先在作品库「复制」一份', 'ri-lock-line'); return; }
        dirty = true;
        setSaveState('编辑中…', true);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 900);
    }
    async function saveNow() {
        if (!cur || !dirty || curIsPublic) return;
        dirty = false;
        try {
            const st = curIsLocal ? LocalStore : ServerStore;
            await st.save({
                id: cur.id,
                name: $('#ed-title').value.trim() || cur.name,
                description: cur.description,
                cover: cur.cover,
                data: cur.data
            });
            setSaveState(curIsLocal ? '已保存（本设备）' : '已保存');
        } catch (e) {
            if (e.status === 401) {
                setSaveState('登录已过期', true);
                toast('登录已过期，请重新登录', 'ri-error-warning-line');
                openAuthModal('login');
            } else {
                dirty = true;
                setSaveState('保存失败', true);
            }
        }
    }

    const sceneNow = () => cur.data.scenes.find(s => s.id === curSceneId);

    // ---------- 场景列表 ----------
    function renderScenes() {
        const list = $('#scene-list');
        list.innerHTML = cur.data.scenes.map(s => {
            const isStart = cur.data.settings.startScene === s.id;
            return `
            <div class="scene-item ${s.id === curSceneId ? 'active' : ''}" data-id="${s.id}">
                <button class="si-star ${isStart ? 'on' : ''}" title="设为开场" data-act="star">${isStart ? '★' : '☆'}</button>
                <span class="si-name">${esc(s.name)}</span>
                <span class="si-count">${s.nodes.length}节</span>
                <button class="si-del" title="删除场景" data-act="del"><i class="ri-close-line"></i></button>
            </div>`;
        }).join('');
        $('#ed-start-name').textContent = (cur.data.scenes.find(s => s.id === cur.data.settings.startScene) || {}).name || '—';
        $('#ed-scene-title').textContent = sceneNow() ? sceneNow().name : '剧本';

        $$('.scene-item', list).forEach(item => {
            const sid = item.dataset.id;
            item.addEventListener('click', (e) => {
                const act = e.target.closest('[data-act]');
                if (act) {
                    e.stopPropagation();
                    if (act.dataset.act === 'star') {
                        cur.data.settings.startScene = sid;
                        markDirty(); renderScenes();
                        toast('已设为开场场景', 'ri-star-line');
                    } else if (act.dataset.act === 'del') {
                        delScene(sid);
                    }
                    return;
                }
                curSceneId = sid;
                editingNodeIdx = -1;
                renderScenes();
                renderNodes();
            });
        });
    }

    function delScene(sid) {
        if (cur.data.scenes.length <= 1) { toast('至少保留一个场景', 'ri-error-warning-line'); return; }
        const s = cur.data.scenes.find(x => x.id === sid);
        if (!confirm(`删除场景「${s.name}」及其全部剧本节点？`)) return;
        cur.data.scenes = cur.data.scenes.filter(x => x.id !== sid);
        if (cur.data.settings.startScene === sid) cur.data.settings.startScene = cur.data.scenes[0].id;
        if (curSceneId === sid) curSceneId = cur.data.scenes[0].id;
        cur.data.scenes.forEach(sc => sc.nodes.forEach(n => {
            if (n.type === 'jump' && n.goto === sid) n.goto = '';
            if (n.type === 'choice') (n.options || []).forEach(o => { if (o.goto === sid) o.goto = ''; });
        }));
        markDirty(); renderScenes(); renderNodes();
    }

    function addScene() {
        const s = { id: uid(), name: '场景 ' + (cur.data.scenes.length + 1), bg: '', bgm: '', nodes: [] };
        cur.data.scenes.push(s);
        curSceneId = s.id;
        editingNodeIdx = -1;
        markDirty(); renderScenes(); renderNodes();
    }

    // ---------- 节点（剧本） ----------
    const NODE_LABEL = {
        dialogue: ['ri-chat-quote-line', '台词'],
        narration: ['ri-book-2-line', '旁白'],
        choice: ['ri-guide-line', '选项'],
        bg: ['ri-landscape-line', '背景'],
        bgm: ['ri-music-2-line', 'BGM'],
        jump: ['ri-rocket-line', '跳转'],
        end: ['ri-flag-line', '结局']
    };

    function nodePreview(n) {
        switch (n.type) {
            case 'dialogue': {
                const c = cur.data.characters.find(x => x.id === n.speaker);
                const nm = n.speaker === '__me__' ? '我' : (c ? c.name : '???');
                return `<b style="color:${c && c.color ? c.color : (n.speaker === '__me__' ? 'var(--blue)' : 'var(--gold)')}">${esc(nm)}</b>　${esc(n.text || '')}`;
            }
            case 'narration': return esc(n.text || '');
            case 'choice': return (n.options || []).map(o => `▸ ${esc(o.text || '')} ${o.goto ? '→ ' + esc(sceneName(o.goto)) : ''}`).join('<br>');
            case 'bg': return (n.value ? `<img class="thumb" src="${esc(n.value)}">` : '') + '<span style="color:var(--dim)">切换背景</span>';
            case 'bgm': return `<i class="ri-music-2-line" style="color:var(--dim)"></i> <span style="color:var(--dim)">${esc(n.value ? '已设置 BGM' : '未设置')}</span>`;
            case 'jump': return `→ 跳转到「${esc(sceneName(n.goto)) || '（未选择）'}」`;
            case 'end': return '<span style="color:rgba(255,122,122,.8)">—— 故事到这里结束 ——</span>';
        }
        return '';
    }
    function sceneName(sid) {
        const s = cur.data.scenes.find(x => x.id === sid);
        return s ? s.name : '';
    }

    function renderNodes() {
        const sc = sceneNow();
        const list = $('#node-list');
        if (!sc) { list.innerHTML = ''; return; }
        if (!sc.nodes.length) {
            list.innerHTML = `<div class="ed-node-list-inner">
                <div style="text-align:center;color:var(--dim);padding:60px 0;">
                    <i class="ri-quill-pen-line" style="font-size:2.2em;display:block;margin-bottom:12px;color:rgba(230,199,138,.4)"></i>
                    这个场景还没有内容<br>用上方按钮添加第一句台词吧
                </div></div>`;
            return;
        }
        list.innerHTML = `<div class="ed-node-list-inner">` + sc.nodes.map((n, i) => `
            <div class="node-card" data-i="${i}">
                <div class="node-head">
                    <span class="node-type-tag t-${n.type}"><i class="${NODE_LABEL[n.type][0]}"></i>${NODE_LABEL[n.type][1]}</span>
                    <div class="node-tools">
                        <button title="上移" data-act="up"><i class="ri-arrow-up-line"></i></button>
                        <button title="下移" data-act="down"><i class="ri-arrow-down-line"></i></button>
                        <button title="复制" data-act="copy"><i class="ri-file-copy-line"></i></button>
                        <button class="del" title="删除" data-act="del"><i class="ri-delete-bin-line"></i></button>
                    </div>
                </div>
                <div class="node-preview">${nodePreview(n)}</div>
            </div>`).join('') + `</div>`;

        $$('.node-card', list).forEach(cardEl => {
            const i = Number(cardEl.dataset.i);
            cardEl.addEventListener('click', (e) => {
                const act = e.target.closest('[data-act]');
                if (act) {
                    e.stopPropagation();
                    nodeAction(act.dataset.act, i);
                    return;
                }
                if (editingNodeIdx === i) { editingNodeIdx = -1; renderNodes(); }
                else { editingNodeIdx = i; renderNodes(); }
            });
        });

        if (editingNodeIdx >= 0 && editingNodeIdx < sc.nodes.length) {
            const cardEl = $(`.node-card[data-i="${editingNodeIdx}"]`, list);
            if (cardEl) {
                const form = document.createElement('div');
                form.className = 'node-edit';
                form.innerHTML = nodeForm(sc.nodes[editingNodeIdx]);
                cardEl.appendChild(form);
                bindNodeForm(form, editingNodeIdx);
                cardEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }

    function nodeAction(act, i) {
        const sc = sceneNow();
        if (act === 'del') {
            sc.nodes.splice(i, 1);
            if (editingNodeIdx === i) editingNodeIdx = -1;
            else if (editingNodeIdx > i) editingNodeIdx--;
        } else if (act === 'up' && i > 0) {
            [sc.nodes[i - 1], sc.nodes[i]] = [sc.nodes[i], sc.nodes[i - 1]];
            if (editingNodeIdx === i) editingNodeIdx = i - 1; else if (editingNodeIdx === i - 1) editingNodeIdx = i;
        } else if (act === 'down' && i < sc.nodes.length - 1) {
            [sc.nodes[i + 1], sc.nodes[i]] = [sc.nodes[i], sc.nodes[i + 1]];
            if (editingNodeIdx === i) editingNodeIdx = i + 1; else if (editingNodeIdx === i + 1) editingNodeIdx = i;
        } else if (act === 'copy') {
            sc.nodes.splice(i + 1, 0, JSON.parse(JSON.stringify(sc.nodes[i])));
        } else return;
        markDirty(); renderNodes();
    }

    function addNode(type) {
        const sc = sceneNow();
        const n = { id: uid(), type };
        if (type === 'dialogue') { n.speaker = cur.data.characters[0] ? cur.data.characters[0].id : '__me__'; n.emotion = ''; n.text = ''; }
        if (type === 'narration') n.text = '';
        if (type === 'choice') n.options = [{ text: '', goto: '' }, { text: '', goto: '' }];
        if (type === 'bg') n.value = '';
        if (type === 'bgm') n.value = '';
        if (type === 'jump') n.goto = cur.data.settings.startScene;
        sc.nodes.push(n);
        editingNodeIdx = sc.nodes.length - 1;
        markDirty(); renderNodes();
    }

    // ---------- 节点表单 ----------
    function speakerOptions(sel) {
        const opts = cur.data.characters.map(c =>
            `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
        return `<option value="__me__" ${sel === '__me__' ? 'selected' : ''}>我（主角）</option>` + opts;
    }
    function sceneOptions(sel, emptyLabel) {
        return `<option value="" ${!sel ? 'selected' : ''}>${emptyLabel || '（选择场景）'}</option>` +
            cur.data.scenes.map(s => `<option value="${s.id}" ${sel === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    }
    function emotionOptions(sel) {
        return `<option value="" ${!sel ? 'selected' : ''}>自动识别</option>` +
            EM_IDS.map(e => `<option value="${e}" ${sel === e ? 'selected' : ''}>${EM[e].zh}</option>`).join('');
    }
    function assetInput(value, key) {
        return `
        <div class="row">
            <input type="url" class="grow" data-k="${key}" placeholder="图片/音频 URL 或上传" value="${esc(value || '')}">
            <button type="button" class="asset-btn" data-upload="${key}"><i class="ri-upload-2-line"></i> 上传</button>
            ${value ? `<img class="asset-preview" src="${esc(value)}" onerror="this.style.display='none'">` : ''}
        </div>`;
    }

    function nodeForm(n) {
        switch (n.type) {
            case 'dialogue': return `
                <div class="row">
                    <select data-k="speaker">${speakerOptions(n.speaker)}</select>
                    <select data-k="emotion">${emotionOptions(n.emotion)}</select>
                    <span class="form-hint">情绪留空则按台词自动识别</span>
                </div>
                <textarea data-k="text" placeholder="写点什么……">${esc(n.text || '')}</textarea>`;
            case 'narration': return `<textarea data-k="text" placeholder="旁白 / 心理描写……">${esc(n.text || '')}</textarea>`;
            case 'choice':
                return (n.options || []).map((o, i) => `
                    <div class="opt-row">
                        <span class="vn-choice-key">${i + 1}</span>
                        <input type="text" data-k="opt-text" data-i="${i}" placeholder="选项文字" value="${esc(o.text || '')}">
                        <select data-k="opt-goto" data-i="${i}">${sceneOptions(o.goto, '→ 继续下一节点')}</select>
                        <button type="button" class="icon-btn del-opt" data-del-opt="${i}" ${n.options.length <= 2 ? 'disabled style="opacity:.3"' : ''}><i class="ri-close-line"></i></button>
                    </div>`).join('') +
                    `<div class="row"><button type="button" class="btn btn-small" id="add-opt"><i class="ri-add-line"></i> 加一个选项</button>
                     <span class="form-hint">选择目标场景实现分支；不选则继续本场景下一节点</span></div>`;
            case 'bg': return assetInput(n.value, 'value');
            case 'bgm': return assetInput(n.value, 'value');
            case 'jump': return `<div class="row"><label style="font-size:.85em;color:var(--dim)">目标场景</label>
                <select data-k="goto" class="grow">${sceneOptions(n.goto)}</select></div>`;
            case 'end': return `<div class="form-hint">播放到此会显示 FIN 结局画面。想让剧情分支不同结局？给每个分支场景末尾各加一个「结局」节点。</div>`;
        }
        return '';
    }

    function bindNodeForm(form, i) {
        const sc = sceneNow();
        const n = sc.nodes[i];
        form.addEventListener('input', (e) => {
            const el = e.target;
            const k = el.dataset.k;
            if (!k) return;
            if (k === 'opt-text') n.options[Number(el.dataset.i)].text = el.value;
            else if (k === 'opt-goto') n.options[Number(el.dataset.i)].goto = el.value;
            else n[k] = el.value;
            markDirty();
            const cardEl = form.closest('.node-card');
            const pv = cardEl.querySelector('.node-preview');
            if (pv && el.tagName !== 'SELECT') pv.innerHTML = nodePreview(n);
        });
        form.addEventListener('change', (e) => {
            const el = e.target;
            if (!el.dataset.k) return;
            markDirty();
            renderNodes();
        });
        form.addEventListener('click', async (e) => {
            const up = e.target.closest('[data-upload]');
            if (up) {
                const inp = document.createElement('input');
                inp.type = 'file';
                inp.accept = 'image/*,audio/*';
                inp.onchange = async () => {
                    if (!inp.files[0]) return;
                    try {
                        const url = await uploadFile(inp.files[0]);
                        n[up.dataset.upload] = url;
                        markDirty(); renderNodes();
                        toast('素材已上传', 'ri-check-line');
                    } catch (err) { toast('上传失败：' + err.message, 'ri-error-warning-line'); }
                };
                inp.click();
                return;
            }
            if (e.target.closest('#add-opt')) {
                n.options.push({ text: '', goto: '' });
                markDirty(); renderNodes();
                return;
            }
            const delOpt = e.target.closest('[data-del-opt]');
            if (delOpt && n.options.length > 2) {
                n.options.splice(Number(delOpt.dataset.delOpt), 1);
                markDirty(); renderNodes();
            }
        });
    }

    // ---------- 角色管理 ----------
    function openCharacters() {
        const chars = cur.data.characters;
        openModal('角色管理', `
            <div id="char-list" style="display:flex;flex-direction:column;gap:10px;">
                ${chars.map(c => `
                <div class="char-card" data-id="${c.id}">
                    <img src="${esc(c.avatar || '')}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'">
                    <div class="cc-info">
                        <div class="cc-name" style="color:${esc(c.color || 'var(--gold)')}">${esc(c.name)}</div>
                        <div class="cc-sub">${c.position === 'left' ? '左侧站位' : c.position === 'right' ? '右侧站位' : '中央站位'} · ${Object.keys(c.sprites || {}).length} 张立绘</div>
                    </div>
                    <div class="cc-btns">
                        <button class="btn btn-small" data-edit="${c.id}"><i class="ri-edit-line"></i> 编辑</button>
                        <button class="btn btn-small btn-danger" data-del="${c.id}"><i class="ri-delete-bin-line"></i></button>
                    </div>
                </div>`).join('') || '<div class="form-hint" style="text-align:center;padding:20px;">还没有角色，先创建一个吧</div>'}
            </div>
            <div style="display:flex;justify-content:space-between;">
                <span class="form-hint">角色的立绘按「情绪」绑定，播放时台词情绪会自动匹配对应立绘。</span>
                <button class="btn btn-gold btn-small" id="char-add"><i class="ri-user-add-line"></i> 新建角色</button>
            </div>`);
        $('#char-add').onclick = () => charForm(null);
        $$('#char-list [data-edit]').forEach(b => b.onclick = () => charForm(b.dataset.edit));
        $$('#char-list [data-del]').forEach(b => b.onclick = () => {
            const c = cur.data.characters.find(x => x.id === b.dataset.del);
            if (!confirm(`删除角色「${c.name}」？已有台词会显示为 ???。`)) return;
            cur.data.characters = cur.data.characters.filter(x => x.id !== b.dataset.del);
            markDirty(); openCharacters(); renderNodes();
        });
    }

    function charForm(cid) {
        const c = cid ? cur.data.characters.find(x => x.id === cid)
            : { id: uid(), name: '', color: '#e6c78a', avatar: '', position: 'center', sprites: {} };
        openModal(cid ? '编辑角色' : '新建角色', `
            <div class="form-row"><label>名字</label><input type="text" id="cf-name" class="grow" maxlength="20" value="${esc(c.name)}" placeholder="角色名"></div>
            <div class="form-row"><label>名字颜色</label><input type="color" id="cf-color" value="${esc(c.color || '#e6c78a')}">
                <label style="width:auto">站位</label>
                <select id="cf-pos">
                    <option value="center" ${c.position === 'center' ? 'selected' : ''}>中央</option>
                    <option value="left" ${c.position === 'left' ? 'selected' : ''}>左侧</option>
                    <option value="right" ${c.position === 'right' ? 'selected' : ''}>右侧</option>
                </select>
            </div>
            <div class="form-row"><label>头像</label>
                <input type="url" id="cf-avatar" class="grow" placeholder="头像 URL 或上传" value="${esc(c.avatar || '')}">
                <button type="button" class="asset-btn" id="cf-avatar-up"><i class="ri-upload-2-line"></i> 上传</button>
            </div>
            <div class="form-hint">立绘（可只配「常规」，其他情绪播放时回退到常规/头像）：</div>
            <div class="sprite-grid" id="sprite-grid">
                ${EM_IDS.map(e => {
                    const url = (c.sprites || {})[e] || '';
                    return `<div class="sprite-slot ${url ? 'filled' : ''}" data-emo="${e}">
                        <button type="button" class="ss-del" data-emo="${e}"><i class="ri-close-line"></i></button>
                        <div class="ss-img">${url ? `<img src="${esc(url)}">` : '<i class="ri-image-add-line"></i>'}</div>
                        <div class="ss-label">${EM[e].zh}</div>
                    </div>`;
                }).join('')}
            </div>
            <div style="display:flex;justify-content:flex-end;gap:10px;">
                <button class="btn" id="cf-cancel">取消</button>
                <button class="btn btn-gold" id="cf-ok"><i class="ri-check-line"></i> 保存</button>
            </div>`);

        $('#cf-avatar-up').onclick = () => pickUpload(url => { c.avatar = url; $('#cf-avatar').value = url; });
        function pickUpload(cb) {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = async () => {
                if (!inp.files[0]) return;
                try { cb(await uploadFile(inp.files[0])); toast('已上传', 'ri-check-line'); }
                catch (e) { toast('上传失败', 'ri-error-warning-line'); }
            };
            inp.click();
        }
        $$('#sprite-grid .sprite-slot').forEach(slot => {
            slot.addEventListener('click', (e) => {
                if (e.target.closest('.ss-del')) {
                    delete c.sprites[slot.dataset.emo];
                    markDirty();
                    slot.classList.remove('filled');
                    slot.querySelector('.ss-img').innerHTML = '<i class="ri-image-add-line"></i>';
                    return;
                }
                pickUpload(url => {
                    c.sprites = c.sprites || {};
                    c.sprites[slot.dataset.emo] = url;
                    markDirty();
                    slot.classList.add('filled');
                    slot.querySelector('.ss-img').innerHTML = `<img src="${esc(url)}">`;
                });
            });
        });
        $('#cf-cancel').onclick = () => openCharacters();
        $('#cf-ok').onclick = () => {
            c.name = $('#cf-name').value.trim() || '未命名';
            c.color = $('#cf-color').value;
            c.position = $('#cf-pos').value;
            c.avatar = $('#cf-avatar').value.trim();
            if (!cid) cur.data.characters.push(c);
            markDirty();
            toast('角色已保存', 'ri-check-line');
            openCharacters(); renderNodes();
        };
    }

    // ---------- 作品设置 ----------
    function openSettings() {
        const st = cur.data.settings;
        openModal('作品设置', `
            <div class="form-row"><label>作品封面</label>
                <input type="url" id="st-cover" class="grow" placeholder="封面图 URL 或上传" value="${esc(cur.cover || '')}">
                <button type="button" class="asset-btn" id="st-cover-up"><i class="ri-upload-2-line"></i> 上传</button>
            </div>
            <div class="form-row"><label>作品简介</label>
                <input type="text" id="st-desc" class="grow" maxlength="200" value="${esc(cur.description || '')}" placeholder="展示在标题画面与作品库">
            </div>
            <div class="form-row"><label>默认皮肤</label>
                <select id="st-skin">
                    <option value="classic" ${st.skin === 'classic' ? 'selected' : ''}>经典</option>
                    <option value="glass" ${st.skin === 'glass' ? 'selected' : ''}>毛玻璃</option>
                    <option value="minimal" ${st.skin === 'minimal' ? 'selected' : ''}>极简</option>
                    <option value="paper" ${st.skin === 'paper' ? 'selected' : ''}>纸张</option>
                </select></div>
            <div class="form-row"><label>打字速度</label>
                <select id="st-speed">
                    <option value="0" ${st.speed === 0 ? 'selected' : ''}>瞬间</option>
                    <option value="1" ${st.speed === 1 ? 'selected' : ''}>慢</option>
                    <option value="2" ${st.speed === 2 ? 'selected' : ''}>标准</option>
                    <option value="3" ${st.speed === 3 ? 'selected' : ''}>快</option>
                </select></div>
            <div class="form-row"><label>背景压暗</label>
                <input type="range" id="st-dim" min="0" max="70" value="${st.bgDim ?? 18}" class="grow">
                <span id="st-dim-v" style="width:36px;font-size:.8em;color:var(--dim)">${st.bgDim ?? 18}%</span></div>
            <div class="form-row"><label>情绪氛围光</label>
                <select id="st-mood">
                    <option value="1" ${st.moodLight !== false ? 'selected' : ''}>开</option>
                    <option value="0" ${st.moodLight === false ? 'selected' : ''}>关</option>
                </select></div>
            <div class="form-hint">以上为播放器默认效果，玩家在游戏内仍可自行调整。</div>
            <div style="display:flex;justify-content:flex-end;gap:10px;">
                <button class="btn" id="st-cancel">取消</button>
                <button class="btn btn-gold" id="st-ok"><i class="ri-check-line"></i> 保存</button>
            </div>`);
        $('#st-dim').oninput = e => $('#st-dim-v').textContent = e.target.value + '%';
        $('#st-cover-up').onclick = () => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = async () => {
                if (!inp.files[0]) return;
                try { $('#st-cover').value = await uploadFile(inp.files[0]); }
                catch (e) { toast('上传失败', 'ri-error-warning-line'); }
            };
            inp.click();
        };
        $('#st-cancel').onclick = closeModal;
        $('#st-ok').onclick = () => {
            cur.cover = $('#st-cover').value.trim();
            cur.description = $('#st-desc').value.trim();
            st.skin = $('#st-skin').value;
            st.speed = Number($('#st-speed').value);
            st.bgDim = Number($('#st-dim').value);
            st.moodLight = $('#st-mood').value === '1';
            markDirty(); closeModal();
            toast('设置已保存', 'ri-check-line');
        };
    }

    // ---------- 试玩 ----------
    function play() {
        $('#player-layer').hidden = false;
        window._vn = window.VNPlayer.create($('#vn-stage'), cur.data, {
            meta: { name: $('#ed-title').value.trim() || cur.name, description: cur.description },
            onExit: () => {
                if (window._vn) window._vn.destroy();
                $('#player-layer').hidden = true;
                $('#player-layer').innerHTML = '<div class="vn-stage" id="vn-stage" tabindex="0"></div>';
            }
        });
    }

    // ---------- 导出 ----------
    function openExport() {
        const hint = curIsLocal
            ? '游客作品直接从本设备数据生成独立 HTML（素材为服务器链接，在线可玩）。'
            : curIsPublic
                ? '公开示例可直接导出；想改成自己的版本，先在作品库「复制」一份。'
                : '整个作品打包成单个 HTML 文件，发给别人双击就能玩，无需安装任何东西。';
        openModal('导出', `
            <div class="form-hint">
                <p style="margin-bottom:10px;"><i class="ri-html5-line" style="color:var(--gold)"></i>
                <b>独立 HTML 播放器</b>：${hint}</p>
                <p><i class="ri-save-3-line" style="color:var(--gold)"></i>
                <b>${user ? '云端保存' : '本地保存'}</b>：${user ? '编辑器内容自动保存在你的账号下，换设备登录也能继续。' : '当前游客模式，数据只保存在这台设备的浏览器里；注册登录后可改为云端保存。'}</p>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="btn" id="ex-close">关闭</button>
                <button class="btn btn-gold" id="ex-html"><i class="ri-download-2-line"></i> 下载独立 HTML</button>
            </div>`);
        $('#ex-close').onclick = closeModal;
        $('#ex-html').onclick = async () => {
            saveNow();
            try {
                if (curIsLocal) {
                    await LocalStore.export(cur);
                } else {
                    await downloadUrl(`/api/projects/${cur.id}/export`, ($('#ed-title').value.trim() || cur.name) + '.html');
                }
            } catch (e) { toast(e.message, 'ri-error-warning-line'); }
        };
    }

    // ---------- 全局事件 ----------
    $('#btn-new-project').onclick = newProject;
    $('#btn-back-lib').onclick = async () => {
        await saveNow();
        $('#page-editor').hidden = true;
        $('#page-library').hidden = false;
        loadLibrary();
    };
    $('#ed-title').addEventListener('input', markDirty);
    $('#btn-add-scene').onclick = addScene;
    $('#btn-characters').onclick = openCharacters;
    $('#btn-settings').onclick = openSettings;
    $('#btn-export').onclick = openExport;
    $('#btn-play').onclick = play;
    $('#modal-close').onclick = closeModal;
    $('#modal-mask').addEventListener('click', (e) => { if (e.target.id === 'modal-mask') closeModal(); });
    $$('.ed-add-node [data-add]').forEach(b => b.onclick = () => addNode(b.dataset.add));
    window.addEventListener('beforeunload', (e) => { if (dirty && !curIsPublic) { saveNow(); e.preventDefault(); e.returnValue = ''; } });

    // ---------- 启动 ----------
    (async () => {
        await refreshUser();
        loadLibrary();
    })();
})();
