// ============================================
// Galgame Studio · 播放引擎
// 视觉复刻自原项目「VN 模式」舞台：
//   双层背景交叉淡入 · 情绪氛围光 · 打字机 + 长句分页
//   选项分支 · 自动播放 · 回顾记录 · 进度存档 · 纯观赏模式
// 既在编辑器内联运行（window.VNPlayer），也被独立导出 HTML 使用。
// ============================================
(function () {
    'use strict';

    const EMOTION_IDS = ['default', 'happy', 'sad', 'angry', 'shy', 'surprised', 'neutral', 'love', 'excited', 'thinking', 'laugh', 'cry'];
    const EMOTION_META = {
        default:    { zh: '常规', icon: 'ri-checkbox-blank-circle-line', color: '#c9ccd8' },
        happy:      { zh: '开心', icon: 'ri-emotion-happy-line',         color: '#ffd66b' },
        sad:        { zh: '难过', icon: 'ri-emotion-sad-line',           color: '#8fb7ff' },
        angry:      { zh: '生气', icon: 'ri-emotion-anger-line',         color: '#ff7a7a' },
        shy:        { zh: '害羞', icon: 'ri-emotion-line',               color: '#ffb0c8' },
        surprised:  { zh: '惊讶', icon: 'ri-eye-line',                   color: '#c7a6ff' },
        neutral:    { zh: '平静', icon: 'ri-emotion-normal-line',        color: '#a9b3c1' },
        love:       { zh: '爱意', icon: 'ri-heart-3-line',               color: '#ff8fae' },
        excited:    { zh: '激动', icon: 'ri-sparkling-2-line',           color: '#ffb26b' },
        thinking:   { zh: '思考', icon: 'ri-lightbulb-line',             color: '#9fe8d8' },
        laugh:      { zh: '大笑', icon: 'ri-emotion-laugh-line',         color: '#ffe08a' },
        cry:        { zh: '哭泣', icon: 'ri-emotion-cry-line',           color: '#8fd8ff' }
    };
    const MOOD_GRADIENT = {
        default:    'radial-gradient(80% 60% at 50% 108%, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 100%)',
        happy:      'radial-gradient(72% 56% at 50% 106%, rgba(255,214,107,.20) 0%, rgba(255,214,107,0) 72%)',
        laugh:      'radial-gradient(72% 56% at 50% 106%, rgba(255,224,138,.24) 0%, rgba(255,224,138,0) 72%)',
        sad:        'radial-gradient(76% 60% at 50% 104%, rgba(120,160,235,.22) 0%, rgba(120,160,235,0) 74%)',
        cry:        'radial-gradient(76% 60% at 50% 104%, rgba(143,216,255,.24) 0%, rgba(143,216,255,0) 74%)',
        angry:      'radial-gradient(74% 58% at 50% 105%, rgba(255,96,96,.22) 0%, rgba(255,96,96,0) 72%)',
        shy:        'radial-gradient(70% 54% at 50% 106%, rgba(255,176,200,.22) 0%, rgba(255,176,200,0) 72%)',
        love:       'radial-gradient(72% 58% at 50% 106%, rgba(255,143,174,.24) 0%, rgba(255,143,174,0) 74%)',
        surprised:  'radial-gradient(70% 62% at 50% 100%, rgba(199,166,255,.20) 0%, rgba(199,166,255,0) 70%)',
        excited:    'radial-gradient(74% 58% at 50% 104%, rgba(255,178,107,.22) 0%, rgba(255,178,107,0) 74%)',
        thinking:   'radial-gradient(78% 56% at 50% 108%, rgba(159,232,216,.16) 0%, rgba(159,232,216,0) 72%)',
        neutral:    'radial-gradient(80% 56% at 50% 108%, rgba(169,179,193,.12) 0%, rgba(169,179,193,0) 76%)'
    };
    const KEYWORDS = {
        cry:       { w: 3.2, k: ['呜呜呜', '大哭', '泪目', '眼泪', '泪流', '泣不成声', '哽咽', '哭着', '哭', '泪', '😭', 'cry', 'crying', 'tears'] },
        laugh:     { w: 3.2, k: ['哈哈哈哈', '哈哈哈', '笑死', '爆笑', '捧腹', '笑出声', '笑到', '233', 'lol', 'lmao', 'hahaha'] },
        love:      { w: 3.0, k: ['我爱你', '喜欢你', '爱你', '心动', '恋慕', '么么', '亲亲', '吻', '想你', '❤', '💕', '💗', 'love'] },
        shy:       { w: 3.0, k: ['害羞', '脸红', '红着脸', '不好意思', '羞', '别扭', '才不是', 'shy', 'blush'] },
        angry:     { w: 3.0, k: ['生气', '愤怒', '恼火', '火大', '气死', '可恶', '混蛋', '闭嘴', '别烦', '怒', '😡', '😠', 'angry', 'furious'] },
        surprised: { w: 2.6, k: ['惊讶', '震惊', '吃惊', '难以置信', '居然', '竟然', '没想到', '天呐', '我的天', '哇', '诶', '咦', '😲', '😮', 'surprised', 'shocked', 'omg'] },
        excited:   { w: 2.6, k: ['兴奋', '激动', '太棒', '好耶', '冲呀', '迫不及待', '等不及', '期待', '来啦', 'amazing', 'awesome', 'excited', 'yay', 'wow'] },
        thinking:  { w: 2.0, k: ['思考', '想了想', '想想', '琢磨', '考虑', '沉思', '也许', '或许', '话说', '嗯……', '嗯…', 'hmm', 'think'] },
        sad:       { w: 2.0, k: ['难过', '伤心', '悲伤', '失落', '沮丧', '孤单', '寂寞', '心疼', '委屈', '无聊', '唉', '叹气', 'sad', 'lonely', 'unhappy'] },
        happy:     { w: 1.4, k: ['开心', '高兴', '愉快', '喜悦', '快乐', '满足', '不错', '哈哈', '嘿嘿', '😊', '😄', '🥰', 'happy', 'joy', 'smile', 'glad', 'nice'] }
    };
    const SPEED_PRESETS = [
        { ms: 0, chunk: 999, label: '瞬间' },
        { ms: 34, chunk: 1, label: '慢' },
        { ms: 20, chunk: 2, label: '标准' },
        { ms: 9, chunk: 3, label: '快' }
    ];
    const DEFAULT_SETTINGS = {
        skin: 'classic', speed: 2, autoDelay: 1600, badge: true,
        kenBurns: true, bgDim: 18, bgBlur: 0, moodLight: true,
        fontSize: 16, position: 'center'
    };

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function inferEmotion(text, explicit) {
        if (explicit && EMOTION_META[explicit]) return explicit;
        const t = String(text || '');
        let best = 'default', bestScore = 0;
        for (const emo in KEYWORDS) {
            let score = 0;
            for (const kw of KEYWORDS[emo].k) if (t.toLowerCase().includes(kw.toLowerCase())) score += KEYWORDS[emo].w;
            if (score > bestScore) { bestScore = score; best = emo; }
        }
        return best;
    }

    const STAGE_HTML = `
        <div class="vn-bg-layer vn-bg-a" id="vn-bg-a"></div>
        <div class="vn-bg-layer vn-bg-b" id="vn-bg-b"></div>
        <div class="vn-dim" id="vn-dim"></div>
        <div class="vn-mood" id="vn-mood" aria-hidden="true"></div>
        <div class="vn-vignette"></div>
        <div class="vn-stage-top">
            <button class="vn-chip vn-settings-btn" id="vn-settings-btn" title="显示设置"><i class="ri-equalizer-line"></i><span>设置</span></button>
            <div class="vn-title-slot" id="vn-title-slot"></div>
            <button class="vn-chip vn-log-btn" id="vn-log-btn" title="回顾记录"><i class="ri-history-line"></i><span>记录</span></button>
            <button class="vn-chip vn-auto-btn" id="vn-auto" title="自动播放 (A)"><i class="ri-play-line"></i></button>
            <button class="vn-chip vn-hide-btn" id="vn-hide-ui" title="隐藏界面，只看背景与立绘 (H)"><i class="ri-eye-off-line"></i></button>
            <button class="vn-chip vn-exit" id="vn-exit" title="退出播放 (Esc)"><i class="ri-arrow-go-back-line"></i><span>退出</span></button>
        </div>
        <div class="vn-character-wrap"><img class="vn-character" id="vn-character" alt="立绘" draggable="false"></div>
        <div class="vn-hint" id="vn-hint" hidden></div>
        <div class="vn-dialogue-box" id="vn-dialogue-box">
            <div class="vn-speaker-row">
                <img class="vn-name-avatar" id="vn-name-avatar" hidden alt="" draggable="false">
                <span class="vn-name" id="vn-name">—</span>
                <button class="vn-badge" id="vn-badge" hidden><i></i><span>—</span></button>
                <span class="vn-spacer"></span>
            </div>
            <div class="vn-text" id="vn-text"></div>
            <div class="vn-foot">
                <div class="vn-controls">
                    <button id="vn-prev" title="上一页 / 回退 (←)"><i class="ri-arrow-left-s-line"></i></button>
                    <button id="vn-speed" title="打字速度"><i class="ri-speed-line"></i><span id="vn-speed-label">标准</span></button>
                    <span class="vn-page-ind" id="vn-page-ind" hidden>1/1</span>
                </div>
                <span class="vn-continue" id="vn-continue" hidden><i class="ri-arrow-down-s-line"></i></span>
                <span id="vn-progress">-/-</span>
            </div>
        </div>
        <div class="vn-choices" id="vn-choices" hidden></div>
        <div class="vn-measure" id="vn-measure" aria-hidden="true" style="position:absolute;visibility:hidden;pointer-events:none;left:-9999px;"></div>
        <div class="vn-log-panel" id="vn-log-panel" hidden>
            <div class="vn-log-head"><i class="ri-history-line"></i> 回顾记录<button class="vn-log-close" id="vn-log-close"><i class="ri-close-line"></i></button></div>
            <div class="vn-log-list" id="vn-log-list"></div>
        </div>
        <div class="vn-settings-panel" id="vn-settings-panel" hidden></div>
        <div class="vn-shot-tip" id="vn-shot-tip"><i class="ri-camera-line"></i><span>纯观赏模式 · 点击画面或按 H 恢复界面</span></div>
    `;

    // ---------------- 播放器实例 ----------------

    function createPlayer(container, project, options) {
        options = options || {};
        const meta = options.meta || {};
        const S = Object.assign({}, DEFAULT_SETTINGS, (project && project.settings) || {}, options.overrides || {});
        delete S.startScene;
        const settings = S;
        const characters = (project && project.characters) || [];
        const scenes = (project && project.scenes) || [];
        const charById = {}; characters.forEach(c => charById[c.id] = c);
        const sceneById = {}; scenes.forEach(s => sceneById[s.id] = s);

        let bgA, bgB, bgFlip = false, curBg = '';
        let moodEl, charEl, nameEl, nameAvatarEl, badgeEl, textEl, boxEl,
            choicesEl, logPanel, logList, hintEl, settingsPanel, pageInd,
            continueEl, progressEl, speedLabel, autoBtn, measureEl, titleSlot, dimEl;
        let stage;
        let state = { sceneId: null, idx: 0, bg: '', bgm: '', waiting: null };
        let typing = false, typeTimer = null, pages = [], pageIdx = 0, fullText = '';
        let autoMode = false, autoTimer = null;
        let log = [];
        let bgmAudio = null;
        let destroyed = false;
        let saveKey = options.saveKey || null;
        let started = false;

        function bgLayer() { return bgFlip ? bgA : bgB; }
        function bgLayerOther() { return bgFlip ? bgB : bgA; }

        // ---------- 初始化 ----------
        function mount() {
            container.innerHTML = '';
            stage = document.createElement('div');
            stage.className = 'vn-stage skin-' + (settings.skin || 'classic');
            stage.tabIndex = 0;
            stage.innerHTML = STAGE_HTML;
            container.appendChild(stage);

            bgA = stage.querySelector('#vn-bg-a');
            bgB = stage.querySelector('#vn-bg-b');
            dimEl = stage.querySelector('#vn-dim');
            moodEl = stage.querySelector('#vn-mood');
            charEl = stage.querySelector('#vn-character');
            nameEl = stage.querySelector('#vn-name');
            nameAvatarEl = stage.querySelector('#vn-name-avatar');
            badgeEl = stage.querySelector('#vn-badge');
            textEl = stage.querySelector('#vn-text');
            boxEl = stage.querySelector('#vn-dialogue-box');
            choicesEl = stage.querySelector('#vn-choices');
            logPanel = stage.querySelector('#vn-log-panel');
            logList = stage.querySelector('#vn-log-list');
            hintEl = stage.querySelector('#vn-hint');
            settingsPanel = stage.querySelector('#vn-settings-panel');
            pageInd = stage.querySelector('#vn-page-ind');
            continueEl = stage.querySelector('#vn-continue');
            progressEl = stage.querySelector('#vn-progress');
            speedLabel = stage.querySelector('#vn-speed-label');
            autoBtn = stage.querySelector('#vn-auto');
            measureEl = stage.querySelector('#vn-measure');
            titleSlot = stage.querySelector('#vn-title-slot');

            titleSlot.textContent = meta.name || '';

            applyVh();
            window.addEventListener('resize', applyVh);
            bindEvents();
            buildSettingsPanel();
            hideBox();
            showTitleScreen();
        }

        function applyVh() {
            const h = stage.clientHeight || window.innerHeight;
            stage.style.setProperty('--vn-vh', (h / 100) + 'px');
            stage.style.setProperty('--vn-box-h', '170px');
            stage.style.setProperty('--vn-fs', (settings.fontSize || 16) + 'px');
            stage.style.setProperty('--vn-dim', (settings.bgDim || 0) / 100);
            stage.style.setProperty('--vn-blur', (settings.bgBlur || 0) + 'px');
        }

        // ---------- 标题画面 ----------
        function showTitleScreen() {
            const hasSave = saveKey && !!localStorage.getItem(saveKey);
            const scr = document.createElement('div');
            scr.className = 'vn-title-screen';
            scr.id = 'vn-title-screen';
            scr.innerHTML = `
                <div class="vn-title-name">${esc(meta.name || '视觉小说')}</div>
                ${meta.description ? '<div class="vn-title-desc">' + esc(meta.description) + '</div>' : ''}
                <div class="vn-title-btns">
                    <button class="vn-title-btn primary" id="vn-btn-start"><i class="ri-play-fill"></i> 开始游戏</button>
                    ${hasSave ? '<button class="vn-title-btn" id="vn-btn-continue"><i class="ri-bookmark-line"></i> 继续进度</button>' : ''}
                </div>`;
            stage.appendChild(scr);
            scr.querySelector('#vn-btn-start').onclick = () => {
                if (saveKey) localStorage.removeItem(saveKey);
                startGame();
            };
            const cbtn = scr.querySelector('#vn-btn-continue');
            if (cbtn) cbtn.onclick = () => {
                try {
                    const p = JSON.parse(localStorage.getItem(saveKey));
                    if (p && p.sceneId) {
                        state = { sceneId: p.sceneId, idx: p.idx || 0, bg: p.bg || '', bgm: p.bgm || '' };
                        if (p.log) log = p.log;
                        dismissTitle(() => { showBox(); restoreEnv(p); runCurrent(); });
                        return;
                    }
                } catch (e) {}
                startGame();
            };
        }
        function dismissTitle(cb) {
            const scr = stage.querySelector('#vn-title-screen');
            if (scr) { scr.classList.add('leaving'); setTimeout(() => scr.remove(), 520); }
            setTimeout(cb, 220);
        }
        function startGame() {
            log = [];
            showBox();
            const sid = (project.settings && project.settings.startScene) || (scenes[0] && scenes[0].id);
            state = { sceneId: sid, idx: 0, bg: '', bgm: '' };
            dismissTitle(() => runCurrent());
        }
        function restoreEnv(p) {
            if (p.bg) setBg(p.bg, true);
            if (p.bgm) setBgm(p.bgm);
        }

        // ---------- 背景 / BGM / 立绘 ----------
        function setBg(url, instant) {
            curBg = url || '';
            if (!url) {
                bgA.classList.remove('show', 'kenburns'); bgB.classList.remove('show', 'kenburns');
                return;
            }
            const showEl = bgLayer(), hideEl = bgLayerOther();
            bgFlip = !bgFlip;
            showEl.style.backgroundImage = 'url("' + url.replace(/"/g, '\\"') + '")';
            showEl.classList.toggle('kenburns', !!settings.kenBurns);
            if (instant) {
                showEl.style.transition = 'none';
                requestAnimationFrame(() => { showEl.classList.add('show'); showEl.style.transition = ''; });
            } else {
                requestAnimationFrame(() => showEl.classList.add('show'));
            }
            hideEl.classList.remove('show');
        }
        function setBgm(url) {
            if (bgmAudio) { bgmAudio.pause(); bgmAudio = null; }
            if (!url) return;
            bgmAudio = new Audio(url);
            bgmAudio.loop = true;
            bgmAudio.volume = 0.45;
            bgmAudio.play().catch(() => {});
        }
        function setMood(emo) {
            if (!settings.moodLight) { moodEl.classList.remove('show'); return; }
            moodEl.style.background = MOOD_GRADIENT[emo] || MOOD_GRADIENT.default;
            moodEl.classList.add('show');
        }
        function showSprite(char, emo) {
            const emoMap = (char && char.sprites) || {};
            let url = emoMap[emo] || emoMap.default || char.avatar || '';
            if (!url) { charEl.classList.remove('show'); return; }
            if (charEl.getAttribute('src') !== url) {
                charEl.classList.remove('show');
                const img = new Image();
                img.onload = () => { if (!destroyed) { charEl.src = url; charEl.classList.add('show'); } };
                img.onerror = () => { if (char.avatar && !destroyed) { charEl.src = char.avatar; charEl.classList.add('show'); } };
                img.src = url;
            } else {
                charEl.classList.add('show');
            }
            charEl.classList.remove('pos-left', 'pos-right', 'pos-center');
            charEl.classList.add('pos-' + (char.position || settings.position || 'center'));
        }
        function hideSprite() { charEl.classList.remove('show'); }

        // ---------- 打字机与分页 ----------
        function paginate(text) {
            const cs = getComputedStyle(textEl);
            measureEl.style.width = textEl.clientWidth + 'px';
            measureEl.style.font = cs.font;
            measureEl.style.lineHeight = cs.lineHeight;
            measureEl.style.letterSpacing = cs.letterSpacing;
            measureEl.style.whiteSpace = 'pre-wrap';
            measureEl.style.wordBreak = 'break-word';
            const maxH = textEl.clientHeight || 200;
            const chars = Array.from(text);
            const out = []; let start = 0;
            while (start < chars.length) {
                let lo = 1, hi = chars.length - start, fit = 1;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    measureEl.textContent = chars.slice(start, start + mid).join('');
                    if (measureEl.offsetHeight <= maxH) { fit = mid; lo = mid + 1; } else { hi = mid - 1; }
                }
                if (fit < 1) fit = 1;
                out.push(chars.slice(start, start + fit).join(''));
                start += fit;
            }
            measureEl.textContent = '';
            return out.length ? out : [''];
        }

        function typePage() {
            clearInterval(typeTimer); typeTimer = null;
            const page = pages[pageIdx] || '';
            const speed = SPEED_PRESETS[settings.speed] || SPEED_PRESETS[2];
            progressEl.textContent = (stateIdxLabel());
            if (speed.ms === 0) {
                textEl.textContent = page;
                typing = false;
                onTyped();
                return;
            }
            typing = true;
            continueEl.hidden = true;
            let i = 0;
            typeTimer = setInterval(() => {
                i += speed.chunk;
                textEl.textContent = page.slice(0, i);
                if (i >= page.length) {
                    clearInterval(typeTimer); typeTimer = null;
                    typing = false;
                    onTyped();
                }
            }, speed.ms);
        }
        function onTyped() {
            continueEl.hidden = false;
            if (autoMode) {
                clearTimeout(autoTimer);
                autoTimer = setTimeout(() => advance(), settings.autoDelay || 1600);
            }
        }

        function stateIdxLabel() {
            const scene = sceneById[state.sceneId];
            if (!scene) return '-/-';
            const total = scene.nodes.length;
            return (Math.min(state.idx + 1, total)) + '/' + total;
        }

        // ---------- 节点执行 ----------
        function runCurrent() {
            if (destroyed) return;
            const scene = sceneById[state.sceneId];
            if (!scene) { showEnd(); return; }
            if (state.idx >= scene.nodes.length) {
                // 场景自然结束：不自动跳，停在这里等作者加「跳转/结局」；提示之
                showEnd(); return;
            }
            const node = scene.nodes[state.idx];
            saveProgress();
            switch (node.type) {
                case 'bg':
                    setBg(node.value);
                    nextNode(); break;
                case 'bgm':
                    setBgm(node.value);
                    nextNode(); break;
                case 'jump':
                    gotoScene(node.goto); break;
                case 'end':
                    showEnd(); break;
                case 'choice':
                    renderChoices(node); break;
                case 'narration':
                case 'dialogue':
                    renderDialogue(node); break;
                default:
                    nextNode();
            }
        }
        function nextNode() { state.idx++; runCurrent(); }
        function gotoScene(sid, idx) {
            if (!sceneById[sid]) { showEnd(); return; }
            state = { sceneId: sid, idx: idx || 0, bg: state.bg, bgm: state.bgm };
            runCurrent();
        }

        function renderDialogue(node) {
            choicesEl.hidden = true;
            const isNarr = node.type === 'narration';
            const emo = inferEmotion(node.text, node.emotion);
            const isMe = node.speaker === '__me__';
            const char = isNarr || isMe ? null : charById[node.speaker];
            boxEl.style.cursor = 'pointer';
            if (isNarr) {
                nameEl.textContent = '旁白';
                nameEl.className = 'vn-name vn-name--narr';
                nameAvatarEl.hidden = true;
                badgeEl.hidden = true;
                hideSprite();
            } else if (isMe) {
                nameEl.textContent = options.playerName || meta.playerName || '我';
                nameEl.className = 'vn-name vn-name--mine';
                nameAvatarEl.hidden = true;
                badgeEl.hidden = true;
                hideSprite();
            } else if (char) {
                nameEl.textContent = char.name || '???';
                nameEl.className = 'vn-name';
                if (char.color) nameEl.style.color = char.color; else nameEl.style.color = '';
                if (char.avatar) { nameAvatarEl.src = char.avatar; nameAvatarEl.hidden = false; }
                else nameAvatarEl.hidden = true;
                if (settings.badge && emo !== 'default') {
                    badgeEl.hidden = false;
                    badgeEl.style.setProperty('--vn-badge-c', EMOTION_META[emo].color);
                    badgeEl.querySelector('i').className = EMOTION_META[emo].icon;
                    badgeEl.querySelector('span').textContent = EMOTION_META[emo].zh;
                } else badgeEl.hidden = true;
                showSprite(char, emo);
            } else {
                nameEl.textContent = '???';
                nameEl.className = 'vn-name';
                nameAvatarEl.hidden = true;
                badgeEl.hidden = true;
            }
            setMood(isNarr ? 'default' : emo);
            fullText = String(node.text || '');
            log.push({ name: isNarr ? '__narr__' : (isMe ? '__me__' : (char ? char.name : '???')), mine: isMe, text: fullText });
            textEl.textContent = '';
            pageIdx = 0;
            requestAnimationFrame(() => {
                pages = paginate(fullText);
                pageInd.hidden = pages.length <= 1;
                updatePageInd();
                typePage();
            });
        }
        function updatePageInd() {
            pageInd.textContent = (pageIdx + 1) + '/' + pages.length;
        }

        function renderChoices(node) {
            hideBox();
            choicesEl.hidden = false;
            choicesEl.innerHTML = '';
            const opts = node.options || [];
            opts.forEach((opt, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'vn-choice-item';
                b.innerHTML = '<span class="vn-choice-key">' + (i + 1) + '</span><span>' + esc(opt.text || '') + '</span>';
                b.onclick = () => {
                    log.push({ name: '__me__', mine: true, text: '▶ ' + (opt.text || '') });
                    choicesEl.hidden = true;
                    choicesEl.innerHTML = '';
                    if (opt.goto && sceneById[opt.goto]) gotoScene(opt.goto);
                    else nextNode();
                };
                choicesEl.appendChild(b);
            });
            const tip = document.createElement('div');
            tip.className = 'vn-choice-tip';
            tip.textContent = '点击选项推进剧情 · 数字键直选';
            choicesEl.appendChild(tip);
            state.waiting = 'choice';
            saveProgress();
        }
        function hideBox() { boxEl.style.display = 'none'; }
        function showBox() { boxEl.style.display = ''; }

        function showEnd() {
            hideBox();
            hideSprite();
            choicesEl.hidden = true;
            if (saveKey) localStorage.removeItem(saveKey);
            const scr = document.createElement('div');
            scr.className = 'vn-title-screen';
            scr.innerHTML = `
                <div class="vn-end-tag">FIN</div>
                <div class="vn-title-desc">感谢游玩</div>
                <div class="vn-title-btns">
                    <button class="vn-title-btn primary" id="vn-btn-restart"><i class="ri-restart-line"></i> 从头再来</button>
                    ${options.onExit !== null ? '<button class="vn-title-btn" id="vn-btn-exit"><i class="ri-arrow-go-back-line"></i> 返回</button>' : ''}
                </div>`;
            stage.appendChild(scr);
            scr.querySelector('#vn-btn-restart').onclick = () => { scr.remove(); log = []; startGame(); };
            const eb = scr.querySelector('#vn-btn-exit');
            if (eb) eb.onclick = () => api.destroy();
        }

        // ---------- 推进逻辑 ----------
        function advance() {
            if (stage.querySelector('#vn-title-screen')) return;
            if (!choicesEl.hidden) return;
            if (typing) {  // 快进本页
                clearInterval(typeTimer); typeTimer = null;
                typing = false;
                textEl.textContent = pages[pageIdx] || '';
                onTyped();
                return;
            }
            if (!boxEl.style.display || boxEl.style.display !== 'none') {
                if (pageIdx < pages.length - 1) {
                    pageIdx++;
                    updatePageInd();
                    typePage();
                    return;
                }
            }
            showBox();
            nextNode();
        }
        function back() {
            const scene = sceneById[state.sceneId];
            if (!scene) return;
            if (pageIdx > 0 && !typing) {
                pageIdx--; updatePageInd();
                textEl.textContent = pages[pageIdx];
                continueEl.hidden = false;
                return;
            }
            if (state.idx > 0) {
                state.idx--;
                const node = scene.nodes[state.idx];
                if (node && (node.type === 'dialogue' || node.type === 'narration')) {
                    log.pop();
                    renderDialogue(node);
                    // 直接显示全部
                    clearInterval(typeTimer);
                    requestAnimationFrame(() => {
                        pages = paginate(fullText);
                        pageIdx = pages.length - 1;
                        updatePageInd();
                        textEl.textContent = pages[pageIdx];
                        typing = false;
                        onTyped();
                    });
                } else {
                    state.idx++;
                    hint('该节点不可回退');
                }
            } else {
                hint('已经是本场景开头了');
            }
        }
        let hintTimer = null;
        function hint(msg) {
            hintEl.textContent = msg;
            hintEl.hidden = false;
            clearTimeout(hintTimer);
            hintTimer = setTimeout(() => hintEl.hidden = true, 1800);
        }

        // ---------- 自动播放 ----------
        function toggleAuto() {
            autoMode = !autoMode;
            autoBtn.classList.toggle('active', autoMode);
            autoBtn.innerHTML = autoMode ? '<i class="ri-pause-line"></i>' : '<i class="ri-play-line"></i>';
            if (autoMode) {
                hint('自动播放已开启');
                if (!typing) advance();
            } else {
                clearTimeout(autoTimer);
            }
        }

        // ---------- 回顾 ----------
        function renderLog() {
            logList.innerHTML = log.map(item => {
                const cls = item.name === '__narr__' ? 'vn-log-name--narr' : (item.mine ? 'vn-log-name--mine' : '');
                const nm = item.name === '__narr__' ? '旁白' : esc(item.name);
                return '<div class="vn-log-item"><div class="vn-log-name ' + cls + '">' + nm + '</div><div class="vn-log-text">' + esc(item.text) + '</div></div>';
            }).join('') || '<div style="color:rgba(255,255,255,.4);font-size:.85em;padding:20px;text-align:center;">还没有对话记录</div>';
            logList.scrollTop = logList.scrollHeight;
        }

        // ---------- 设置面板 ----------
        function buildSettingsPanel() {
            settingsPanel.innerHTML = `
                <div class="vn-set-row"><label>皮肤</label>
                    <div class="vn-set-switch" data-key="skin">
                        <button data-v="classic">经典</button><button data-v="glass">毛玻璃</button>
                        <button data-v="minimal">极简</button><button data-v="paper">纸张</button>
                    </div></div>
                <div class="vn-set-row"><label>打字速度</label>
                    <input type="range" min="0" max="3" step="1" value="${settings.speed}" data-key="speed"></div>
                <div class="vn-set-row"><label>自动停顿</label>
                    <input type="range" min="400" max="4000" step="100" value="${settings.autoDelay}" data-key="autoDelay"></div>
                <div class="vn-set-row"><label>字号</label>
                    <input type="range" min="13" max="24" step="1" value="${settings.fontSize}" data-key="fontSize"></div>
                <div class="vn-set-row"><label>背景压暗</label>
                    <input type="range" min="0" max="70" step="1" value="${settings.bgDim}" data-key="bgDim"></div>
                <div class="vn-set-row"><label>背景模糊</label>
                    <input type="range" min="0" max="14" step="1" value="${settings.bgBlur}" data-key="bgBlur"></div>
                <div class="vn-set-row"><label>氛围光</label>
                    <div class="vn-set-switch" data-key="moodLight"><button data-v="1">开</button><button data-v="0">关</button></div></div>
                <div class="vn-set-row"><label>背景推移</label>
                    <div class="vn-set-switch" data-key="kenBurns"><button data-v="1">开</button><button data-v="0">关</button></div></div>
                <div class="vn-set-row"><label>情绪徽标</label>
                    <div class="vn-set-switch" data-key="badge"><button data-v="1">开</button><button data-v="0">关</button></div></div>
            `;
            settingsPanel.addEventListener('click', (e) => {
                const b = e.target.closest('.vn-set-switch button');
                if (!b) return;
                const sw = b.closest('.vn-set-switch');
                const key = sw.dataset.key;
                let v = b.dataset.v;
                if (v === '1') v = true; else if (v === '0') v = false;
                settings[key] = v;
                syncSwitches();
                applyVh();
            });
            settingsPanel.addEventListener('input', (e) => {
                const r = e.target.closest('input[type=range]');
                if (!r) return;
                settings[r.dataset.key] = Number(r.value);
                if (r.dataset.key === 'speed') speedLabel.textContent = SPEED_PRESETS[settings.speed].label;
                applyVh();
            });
            syncSwitches();
        }
        function syncSwitches() {
            settingsPanel.querySelectorAll('.vn-set-switch').forEach(sw => {
                const key = sw.dataset.key;
                const cur = String(settings[key]);
                sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === cur));
            });
        }

        // ---------- 进度 ----------
        function saveProgress() {
            if (!saveKey) return;
            try {
                localStorage.setItem(saveKey, JSON.stringify({
                    sceneId: state.sceneId, idx: state.idx, bg: curBg, bgm: state.bgm, log: log.slice(-100)
                }));
            } catch (e) {}
        }

        // ---------- 事件 ----------
        function bindEvents() {
            stage.addEventListener('click', (e) => {
                if (e.target.closest('button, .vn-log-panel, .vn-settings-panel, .vn-choices, input, select, a')) return;
                if (autoMode) { toggleAuto(); return; }
                advance();
            });
            stage.addEventListener('keydown', (e) => {
                if (e.target.matches('input, textarea, select')) return;
                if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); advance(); }
                else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
                else if (e.key === 'a' || e.key === 'A') toggleAuto();
                else if (e.key === 'h' || e.key === 'H') toggleHideUI();
                else if (e.key === 'Escape') {
                    if (!logPanel.hidden) logPanel.hidden = true;
                    else if (!settingsPanel.hidden) settingsPanel.hidden = true;
                    else if (options.onExit) options.onExit();
                }
            });
            stage.querySelector('#vn-prev').onclick = (e) => { e.stopPropagation(); back(); };
            stage.querySelector('#vn-speed').onclick = (e) => {
                e.stopPropagation();
                settings.speed = (settings.speed + 1) % SPEED_PRESETS.length;
                speedLabel.textContent = SPEED_PRESETS[settings.speed].label;
                syncSwitches();
            };
            autoBtn.onclick = (e) => { e.stopPropagation(); toggleAuto(); };
            stage.querySelector('#vn-log-btn').onclick = (e) => {
                e.stopPropagation(); renderLog(); logPanel.hidden = false;
            };
            stage.querySelector('#vn-log-close').onclick = () => logPanel.hidden = true;
            stage.querySelector('#vn-hide-ui').onclick = (e) => { e.stopPropagation(); toggleHideUI(); };
            const exitBtn = stage.querySelector('#vn-exit');
            if (options.onExit === null) exitBtn.style.display = 'none';
            else exitBtn.onclick = (e) => { e.stopPropagation(); options.onExit && options.onExit(); };
            stage.querySelector('#vn-settings-btn').onclick = (e) => {
                e.stopPropagation();
                settingsPanel.hidden = !settingsPanel.hidden;
            };
            badgeEl.onclick = (e) => { e.stopPropagation(); };
        }
        function toggleHideUI() {
            stage.classList.toggle('ui-hidden');
            stage.classList.toggle('shot-mode');
        }

        // ---------- 销毁 ----------
        function destroy() {
            destroyed = true;
            clearInterval(typeTimer); typeTimer = null;
            clearTimeout(autoTimer);
            if (bgmAudio) { bgmAudio.pause(); bgmAudio = null; }
            container.innerHTML = '';
        }

        const api = {
            destroy,
            jumpTo: (sid, idx) => { state = { sceneId: sid, idx: idx || 0, bg: '', bgm: '' }; runCurrent(); },
            getState: () => state
        };

        mount();
        return api;
    }

    window.VNPlayer = {
        create: createPlayer,
        EMOTION_IDS, EMOTION_META, MOOD_GRADIENT, inferEmotion
    };

    // 独立导出页自动启动
    if (typeof window.__VN_PROJECT__ !== 'undefined' && window.__VN_PROJECT__) {
        document.addEventListener('DOMContentLoaded', () => {
            const pack = window.__VN_PROJECT__;
            VNPlayer.create(
                document.getElementById('vn-stage'),
                pack.project,
                {
                    meta: pack.meta || {},
                    saveKey: 'vn_progress_' + (pack.meta && pack.meta.name ? pack.meta.name : 'export'),
                    onExit: null
                }
            );
        });
    }
})();
