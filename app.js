/**
 * The 3AM Channel — Main Application
 *
 * Features: Whisper Threads · Mood Tags · Ghost Post · Heartbeat · Exit Ritual
 *           Reply Notifications · Feed Refresh · Report Posts · Onboarding
 *           Typing Indicator · Haptic Feedback · Share as Image
 */

(function () {
    'use strict';

    // ========================================
    // Configuration
    // ========================================
    const CONFIG = {
        OPEN_HOUR: 3,
        OPEN_MINUTE: 0,
        CLOSE_HOUR: 6,
        CLOSE_MINUTE: 0,
        PRE_OPEN_MINUTES: 15,
        // Soft indicator thresholds — never block posting
        SOFT_POST_WARN: 500,
        SOFT_REPLY_WARN: 280,
        REACTIONS: ['😔', '💀', '🫂', '❤️‍🩹'],
        MOODS: ['anxious', 'sad', 'excited', 'lonely', "can't stop thinking", 'just bored'],
        CUSTOM_MOOD_PLACEHOLDER: '✏️ other...',
        MOOD_EMOJIS: {
            'anxious': '🫀',
            'sad': '🩶',
            'excited': '⚡',
            'lonely': '🌑',
            "can't stop thinking": '🌀',
            'just bored': '🌫️'
        },
        ANIMATION_DURATION: 400,
        TIME_SYNC_INTERVAL_MS: 30000,
        EXIT_WARN_1: 5,
        EXIT_WARN_2: 2,
        PTR_THRESHOLD: 80,
        PTR_MAX_SHIFT: 56,
        TYPING_DEBOUNCE_MS: 3000,
        TYPING_STOP_DEBOUNCE_MS: 3000,
    };

    // ════════════════════════════════════════════════════════
    // STARFIELD — canvas background animation
    // ════════════════════════════════════════════════════════
    (function initStarfield() {
        const canvas = document.getElementById('starfield');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const STAR_COUNT  = 160;
        const SPEED_MIN   = 0.04;
        const SPEED_MAX   = 0.18;
        const SIZE_MIN    = 0.4;
        const SIZE_MAX    = 1.8;

        let stars = [];
        let W = 0, H = 0;
        let rafId = null;

        function randomStar(overrideX) {
            return {
                x:     overrideX !== undefined ? overrideX : Math.random() * W,
                y:     Math.random() * H,
                r:     SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN),
                speed: SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN),
                // Twinkle: each star has its own phase offset
                phase: Math.random() * Math.PI * 2,
                twinkleSpeed: 0.004 + Math.random() * 0.008,
            };
        }

        function resize() {
            W = canvas.width  = window.innerWidth;
            H = canvas.height = window.innerHeight;
            // Re-seed so stars fill the new size
            stars = Array.from({ length: STAR_COUNT }, () => randomStar());
        }

        function draw(ts) {
            ctx.clearRect(0, 0, W, H);

            stars.forEach(s => {
                // Drift upward very slowly
                s.y -= s.speed;
                if (s.y + s.r < 0) {
                    // Wrap: reappear at bottom
                    s.y = H + s.r;
                    s.x = Math.random() * W;
                }

                // Twinkle via sine wave on opacity
                s.phase += s.twinkleSpeed;
                const alpha = 0.25 + 0.55 * ((Math.sin(s.phase) + 1) / 2);

                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(200, 195, 255, ${alpha})`;
                ctx.fill();
            });

            rafId = requestAnimationFrame(draw);
        }

        // Only animate when the closed/opening screen is visible
        // (stops when open screen takes over, resumes on close)
        let running = false;

        function start() {
            if (running) return;
            running = true;
            rafId = requestAnimationFrame(draw);
        }

        function stop() {
            running = false;
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        }

        resize();
        window.addEventListener('resize', resize, { passive: true });

        // Expose start/stop for the screen-switch logic
        window.__starfield = { start, stop };

        // Start immediately (closed screen is default)
        start();
    })();

    // ========================================
    // State
    // ========================================
    // If the server injected __DEV_OVERRIDE=true via /dev-config.js (loaded
    // synchronously before this script), activate spoof mode immediately so the
    // FIRST tick() call shows the open screen without any async wait.
    const _initialSpoofMode = (window.__DEV_OVERRIDE === true) ||
                              (localStorage.getItem('3am_spoof') === 'true');
    if (window.__DEV_OVERRIDE === true) {
        localStorage.setItem('3am_spoof', 'true');
    }

    const AppState = {
        CLOSED: 'closed',
        OPENING_SOON: 'opening-soon',
        OPEN: 'open',
        current: null,
        posts: [],
        activeMoodFilter: null,
        timezone: null,
        lastTimeCheck: 0,
        serverTimeOffset: 0,
        socket: null,
        isSpoofMode: _initialSpoofMode,
        isPosting: false,
        isLoading: false,
        openWhisperPostId: null,
        replyingPostIds: new Set(),
        selectedMood: null,
        exitWarn1Shown: false,
        exitWarn2Shown: false,
        exitRitualStarted: false,
        ghostShown: false,

        // ── Reply Notifications ──────────────────────────────────
        newReplies: new Set(),
        notifications: [],
        notifDrawerOpen: false,

        // ── Feed Refresh ─────────────────────────────────────────
        queuedPosts: [],
        ptrStartY: 0,
        ptrDelta: 0,
        ptrActive: false,
        ptrRefreshing: false,

        // ── Reports ──────────────────────────────────────────────
        reportedPosts: new Set(),   // postIds already reported this session
        hiddenPosts: new Set(),     // postIds hidden from feed (local only)
        activeMenuPostId: null,     // which post's ··· menu is open
        reportPickerPostId: null,   // which post's report reason picker is open

        // ── Typing ───────────────────────────────────────────────
        isTyping: false,
        typingStopTimer: null,
    };

    // ========================================
    // User Identity (cached)
    // ========================================
    let _userId = null;
    function getUserId() {
        if (_userId) return _userId;
        _userId = localStorage.getItem('3am_user_id');
        if (!_userId) {
            _userId = Date.now().toString(36) + Math.random().toString(36).substr(2);
            localStorage.setItem('3am_user_id', _userId);
        }
        return _userId;
    }

    // Returns the short "soul #xxxx" identifier derived from the userId
    function getSoulId() {
        return 'soul #' + getUserId().slice(0, 4);
    }

    function updatePostingAsPreview() {
        const el = DOM.open.postingAsPreview;
        if (!el) return;
        const isAnon = DOM.open.anonymousCheck ? DOM.open.anonymousCheck.checked : true;
        el.textContent = 'posting as: ' + (isAnon ? 'anonymous' : getSoulId());
    }

    // ========================================
    // DOM Elements
    // ========================================
    const DOM = {
        screens: {
            closed:  document.getElementById('closed-screen'),
            opening: document.getElementById('opening-screen'),
            open:    document.getElementById('open-screen')
        },
        closed: {
            countdown: document.getElementById('countdown'),
            timezone:  document.getElementById('timezone-display')
        },
        opening: { minutesUntil: document.getElementById('minutes-until') },
        open: {
            postInput:         document.getElementById('post-input'),
            anonymousCheck:    document.getElementById('anonymous-check'),
            postButton:        document.getElementById('post-button'),
            charCount:         document.getElementById('char-count'),
            postingAsPreview:  document.getElementById('posting-as-preview'),
            feed:              document.getElementById('feed'),
            emptyFeed:         document.getElementById('empty-feed'),
            feedLoading:       document.getElementById('feed-loading'),
            postCount:         document.getElementById('post-count'),
            currentTime:       document.getElementById('current-time'),
            timeRemaining:     document.getElementById('time-remaining'),
            moodPicker:        document.getElementById('mood-picker'),
            moodFilterBar:     document.getElementById('mood-filter-bar'),
            newPostsPill:      document.getElementById('new-posts-pill'),
            newPostsPillText:  document.getElementById('new-posts-pill-text'),
            ptrIndicator:      document.getElementById('ptr-indicator'),
            ptrLabel:          document.getElementById('ptr-label'),
            desktopRefreshBtn: document.getElementById('desktop-refresh-btn'),
            typingIndicator:   document.getElementById('typing-indicator'),
            typingText:        document.getElementById('typing-text'),
        },
        toast:                document.getElementById('toast'),
        liveIndicator:        document.getElementById('live-indicator'),
        userCountValue:       document.getElementById('user-count-value'),
        activeUsersContainer: document.getElementById('active-users'),
        ghostOverlay:         document.getElementById('ghost-overlay'),
        ghostText:            document.getElementById('ghost-text'),
        ghostMood:            document.getElementById('ghost-mood'),
        notifBell:            document.getElementById('notif-bell'),
        notifBadge:           document.getElementById('notif-badge'),
        notifDrawer:          document.getElementById('notif-drawer'),
        notifDrawerClose:     document.getElementById('notif-drawer-close'),
        notifBackdrop:        document.getElementById('notif-backdrop'),
        notifList:            document.getElementById('notif-list'),
        notifEmpty:           document.getElementById('notif-empty'),
        reportPicker:         document.getElementById('report-picker'),
        reportBackdrop:       document.getElementById('report-backdrop'),
        onboardingOverlay:    document.getElementById('onboarding-overlay'),
    };

    // ════════════════════════════════════════════════════════
    // HAPTIC FEEDBACK
    // ════════════════════════════════════════════════════════
    function safeVibrate(pattern) {
        try {
            if (navigator.vibrate) navigator.vibrate(pattern);
        } catch (e) { /* silent — iOS will fail quietly */ }
    }

    // ════════════════════════════════════════════════════════
    // TOAST (normal + poetic variant)
    // ════════════════════════════════════════════════════════
    let toastTimeout = null;
    function showToast(message, duration = 3000, variant = '') {
        if (toastTimeout) clearTimeout(toastTimeout);
        let cls = 'toast show';
        if (variant === 'exit')   cls += ' exit-toast';
        if (variant === 'poetic') cls += ' poetic-toast';
        DOM.toast.className = cls;
        DOM.toast.textContent = message;
        toastTimeout = setTimeout(() => { DOM.toast.className = 'toast'; }, duration);
    }

    function showPoeticToast(message) {
        showToast(message, 4000, 'poetic');
    }

    // ════════════════════════════════════════════════════════
    // ONBOARDING
    // ════════════════════════════════════════════════════════
    let onboardingSlide = 0;
    const ONBOARDING_TOTAL = 3;

    function initOnboarding() {
        if (localStorage.getItem('3am_visited')) return; // already seen

        const overlay = DOM.onboardingOverlay;
        if (!overlay) return;
        overlay.hidden = false;

        // Initialise first slide visible
        updateOnboardingSlide(0, /* animate= */ false);

        // Buttons
        document.getElementById('onboarding-skip').addEventListener('click', dismissOnboarding);
        document.getElementById('onboarding-prev').addEventListener('click', () => goOnboardingSlide(onboardingSlide - 1));
        document.getElementById('onboarding-next').addEventListener('click', () => goOnboardingSlide(onboardingSlide + 1));
        document.getElementById('onboarding-enter').addEventListener('click', dismissOnboarding);

        // Keyboard
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') goOnboardingSlide(onboardingSlide + 1);
            if (e.key === 'ArrowLeft')  goOnboardingSlide(onboardingSlide - 1);
        });

        // Swipe
        let swipeStartX = null;
        overlay.addEventListener('touchstart', (e) => { swipeStartX = e.touches[0].clientX; }, { passive: true });
        overlay.addEventListener('touchend', (e) => {
            if (swipeStartX === null) return;
            const dx = e.changedTouches[0].clientX - swipeStartX;
            swipeStartX = null;
            if (Math.abs(dx) < 40) return;
            goOnboardingSlide(dx < 0 ? onboardingSlide + 1 : onboardingSlide - 1);
        }, { passive: true });

        // Trap focus
        overlay.setAttribute('tabindex', '-1');
        overlay.focus();
    }

    function goOnboardingSlide(n) {
        if (n < 0 || n >= ONBOARDING_TOTAL) return;
        updateOnboardingSlide(n, true);
    }

    function updateOnboardingSlide(n, animate) {
        onboardingSlide = n;
        const slides = document.querySelectorAll('.onboarding-slide');
        const dots   = document.querySelectorAll('.onboarding-dot');
        const prev   = document.getElementById('onboarding-prev');
        const next   = document.getElementById('onboarding-next');
        const enter  = document.getElementById('onboarding-enter');

        slides.forEach((s, i) => {
            s.classList.toggle('active', i === n);
            if (animate) {
                // Remove first so re-adding always triggers the animation
                s.classList.remove('fade-in');
                if (i === n) {
                    // Force reflow so the animation restarts cleanly
                    void s.offsetWidth;
                    s.classList.add('fade-in');
                }
            }
        });
        dots.forEach((d, i) => d.classList.toggle('active', i === n));

        prev.hidden  = (n === 0);
        next.hidden  = (n === ONBOARDING_TOTAL - 1);
        enter.hidden = (n !== ONBOARDING_TOTAL - 1);
    }

    function dismissOnboarding() {
        localStorage.setItem('3am_visited', 'true');
        const overlay = DOM.onboardingOverlay;
        if (!overlay) return;
        overlay.classList.add('fading');
        setTimeout(() => { overlay.hidden = true; overlay.classList.remove('fading'); }, 600);
    }

    // ════════════════════════════════════════════════════════
    // UTILITIES
    // ════════════════════════════════════════════════════════
    function formatTime(date) {
        return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')}`;
    }
    function formatTimeShort(date) {
        return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
    }
    function formatCountdown(ms) {
        if (ms <= 0) return '00:00:00';
        const total = Math.floor(ms / 1000);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    function sanitizeInput(text) {
        return String(text).trim();
    }

    function isAtScrollTop() { return window.scrollY < 8; }

    // ════════════════════════════════════════════════════════
    // TIME (Server-Synced)
    // ════════════════════════════════════════════════════════
    async function syncServerTime() {
        try {
            const before = Date.now();
            const res = await fetch('/api/time', { signal: AbortSignal.timeout(3000) });
            const after = Date.now();
            if (res.ok) {
                const data = await res.json();
                AppState.serverTimeOffset = (data.timestamp + (after - before) / 2) - after;
            }
        } catch (e) { /* silent */ }
    }

    function getTrustedTime() {
        const now = new Date(Date.now() + AppState.serverTimeOffset);
        return { time: now, timestamp: now.getTime() };
    }

    function getTimezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone; }

    function getMinutesIntoSession(date) {
        const openMs = (CONFIG.OPEN_HOUR * 60 + CONFIG.OPEN_MINUTE) * 60000;
        const nowMs  = (date.getHours() * 60 + date.getMinutes()) * 60000 + date.getSeconds() * 1000;
        return Math.max(0, (nowMs - openMs) / 60000);
    }

    function getSessionDurationMinutes() {
        return (CONFIG.CLOSE_HOUR * 60 + CONFIG.CLOSE_MINUTE) - (CONFIG.OPEN_HOUR * 60 + CONFIG.OPEN_MINUTE);
    }

    function isInOpenWindow(date) {
        if (AppState.isSpoofMode) return true;
        const total = date.getHours() * 60 + date.getMinutes();
        return total >= CONFIG.OPEN_HOUR * 60 + CONFIG.OPEN_MINUTE && total < CONFIG.CLOSE_HOUR * 60 + CONFIG.CLOSE_MINUTE;
    }

    function isInPreOpenWindow(date) {
        if (AppState.isSpoofMode) return false;
        const total = date.getHours() * 60 + date.getMinutes();
        const open  = CONFIG.OPEN_HOUR * 60 + CONFIG.OPEN_MINUTE;
        return total >= open - CONFIG.PRE_OPEN_MINUTES && total < open;
    }

    function getNextOpeningTime(date) {
        const next = new Date(date);
        next.setHours(CONFIG.OPEN_HOUR, CONFIG.OPEN_MINUTE, 0, 0);
        if (next <= date) next.setDate(next.getDate() + 1);
        return next;
    }

    function getMinutesUntilOpen(date) { return Math.max(0, Math.ceil((getNextOpeningTime(date) - date) / 60000)); }
    function getMinutesUntilClose(date) {
        const close = new Date(date); close.setHours(CONFIG.CLOSE_HOUR, CONFIG.CLOSE_MINUTE, 0, 0);
        return Math.max(0, Math.ceil((close - date) / 60000));
    }
    function getSecondsUntilClose(date) {
        const close = new Date(date); close.setHours(CONFIG.CLOSE_HOUR, CONFIG.CLOSE_MINUTE, 0, 0);
        return Math.max(0, (close - date) / 1000);
    }

    function getCurrentState(date) {
        if (isInOpenWindow(date))    return AppState.OPEN;
        if (isInPreOpenWindow(date)) return AppState.OPENING_SOON;
        return AppState.CLOSED;
    }

    // ════════════════════════════════════════════════════════
    // GHOST POST
    // ════════════════════════════════════════════════════════
    async function loadAndShowGhost() {
        if (AppState.ghostShown) return;
        AppState.ghostShown = true;
        try {
            const res = await fetch('/api/ghost', { signal: AbortSignal.timeout(4000) });
            if (!res.ok) return;
            const data = await res.json();
            if (data.ghost) showGhostOverlay(data.ghost);
        } catch (e) { /* skip */ }
    }

    function showGhostOverlay(ghost) {
        if (!DOM.ghostOverlay || !DOM.ghostText) return;
        DOM.ghostText.textContent = ghost.content;
        if (ghost.mood && DOM.ghostMood) {
            DOM.ghostMood.textContent = `${CONFIG.MOOD_EMOJIS[ghost.mood] || ''} ${ghost.mood}`;
            DOM.ghostMood.style.display = '';
        } else if (DOM.ghostMood) {
            DOM.ghostMood.style.display = 'none';
        }
        DOM.ghostOverlay.classList.add('active');
        const autoDismiss = setTimeout(() => dismissGhost(), 10000);
        DOM.ghostOverlay.addEventListener('click', () => { clearTimeout(autoDismiss); dismissGhost(); }, { once: true });
    }

    function dismissGhost() {
        if (!DOM.ghostOverlay) return;
        DOM.ghostOverlay.classList.add('fading');
        setTimeout(() => DOM.ghostOverlay.classList.remove('active', 'fading'), 800);
    }

    // ════════════════════════════════════════════════════════
    // EXIT RITUAL
    // ════════════════════════════════════════════════════════
    function checkExitRitual(now) {
        // Skip entirely in dev/spoof mode — exit ritual firing at 2PM would be bad
        if (AppState.isSpoofMode) return;
        const secsLeft = getSecondsUntilClose(now);
        const minsLeft = secsLeft / 60;
        if (minsLeft <= CONFIG.EXIT_WARN_1 && minsLeft > CONFIG.EXIT_WARN_2 && !AppState.exitWarn1Shown) {
            AppState.exitWarn1Shown = true;
            showToast('5 minutes left. everything disappears at 6.', 8000, 'exit');
        }
        if (minsLeft <= CONFIG.EXIT_WARN_2 && minsLeft > 0 && !AppState.exitWarn2Shown) {
            AppState.exitWarn2Shown = true;
            showToast('almost gone.', 8000, 'exit');
        }
        if (secsLeft <= 0 && !AppState.exitRitualStarted) {
            AppState.exitRitualStarted = true;
            safeVibrate([100, 50, 100, 50, 200]);
            startExitRitual();
        }
    }

    function startExitRitual() {
        const createSection = document.querySelector('.create-post-section');
        if (createSection) { createSection.style.opacity = '0'; createSection.style.pointerEvents = 'none'; }
        const cards = Array.from(DOM.open.feed.querySelectorAll('.post-card'));
        cards.forEach((card, i) => setTimeout(() => card.classList.add('exit-fade'), i * 200));
        setTimeout(showExitMessage, cards.length * 200 + 1200);
    }

    function showExitMessage() {
        DOM.screens.open.classList.add('exit-screen');
        const exitMsg = document.getElementById('exit-message');
        if (exitMsg) exitMsg.classList.add('active');
        setTimeout(() => {
            AppState.current          = null;
            AppState.exitWarn1Shown   = false;
            AppState.exitWarn2Shown   = false;
            AppState.exitRitualStarted = false;
            AppState.ghostShown       = false;
            AppState.newReplies.clear();
            AppState.notifications    = [];
            AppState.queuedPosts      = [];
            updateBell();
            hideNewPostsPill();
            tick();
        }, 4000);
    }

    // ════════════════════════════════════════════════════════
    // HEARTBEAT
    // ════════════════════════════════════════════════════════
    function getHeartbeatStyle(now) {
        // In spoof/dev mode outside the real window, return a stable "early session" heartbeat
        if (AppState.isSpoofMode) {
            const secsLeft = getSecondsUntilClose(now);
            if (secsLeft <= 0) {
                // We're past 6AM in real time — use stable dev values
                return { pulseDuration: 1.2, color: 'var(--accent-primary)' };
            }
        }
        const progress = Math.min(1, getMinutesIntoSession(now) / getSessionDurationMinutes());
        const secsLeft = getSecondsUntilClose(now);
        const pulseDuration = 0.6 + progress * 1.8;
        let color;
        if      (secsLeft > 15 * 60) color = 'var(--accent-primary)';
        else if (secsLeft >  5 * 60) { const t = 1 - (secsLeft - 5*60)/(10*60); color = `hsl(${30+(1-t)*240},85%,60%)`; }
        else                          color = '#e05555';
        return { pulseDuration, color };
    }

    // ════════════════════════════════════════════════════════
    // TYPING INDICATOR
    // ════════════════════════════════════════════════════════
    function emitTypingStart() {
        if (!AppState.socket) return;
        AppState.socket.emit('typing_start', { userId: getUserId() });
        AppState.isTyping = true;
    }

    function emitTypingStop() {
        if (!AppState.socket || !AppState.isTyping) return;
        AppState.socket.emit('typing_stop');
        AppState.isTyping = false;
    }

    function updateTypingIndicator(count) {
        const indicator = DOM.open.typingIndicator;
        const text      = DOM.open.typingText;
        if (!indicator || !text) return;

        // Subtract self if we are currently typing
        const othersCount = AppState.isTyping ? count - 1 : count;

        if (othersCount <= 0) {
            indicator.hidden = true;
            return;
        }
        text.textContent = othersCount === 1
            ? 'someone is awake and typing...'
            : 'a few souls are awake and typing...';
        indicator.hidden = false;
    }

    // ════════════════════════════════════════════════════════
    // REPLY NOTIFICATIONS
    // ════════════════════════════════════════════════════════
    function handleReplyNotification(updatedPost, prevRepliesLen) {
        const myId = getUserId();
        // Only notify the post owner
        if (updatedPost.userId !== myId) return;
        const allReplies = updatedPost.replies || [];
        const newLen = allReplies.length;
        if (newLen <= prevRepliesLen) return;
        // Count brand-new replies that were NOT written by the post owner
        // (self-whisper on own post should still notify — the owner might want
        //  to know their thread is active, but we exclude only exact owner replies)
        const brandNewReplies = allReplies.slice(prevRepliesLen);
        // Notify for any new reply on your post (even your own, so you see thread activity)
        // but filter out replies from yourself to avoid self-spam
        const externalReplies = brandNewReplies.filter(r => r.userId !== myId);
        if (externalReplies.length === 0) return;
        AppState.newReplies.add(updatedPost.id);
        const snippet  = updatedPost.content.slice(0, 30) + (updatedPost.content.length > 30 ? '…' : '');
        const existing = AppState.notifications.find(n => n.postId === updatedPost.id);
        if (existing) { existing.count += externalReplies.length; existing.timestamp = Date.now(); }
        else AppState.notifications.unshift({ postId: updatedPost.id, postSnippet: snippet, count: externalReplies.length, timestamp: Date.now() });
        updateBell(true);
    }

    function updateBell(shake = false) {
        if (!DOM.notifBell || !DOM.notifBadge) return;
        const total = AppState.notifications.reduce((s, n) => s + n.count, 0);
        if (total > 0) { DOM.notifBadge.textContent = total > 9 ? '9+' : String(total); DOM.notifBadge.hidden = false; }
        else DOM.notifBadge.hidden = true;
        if (shake) {
            DOM.notifBell.classList.remove('bell-shake');
            void DOM.notifBell.offsetWidth;
            DOM.notifBell.classList.add('bell-shake');
        }
    }

    function openNotifDrawer() {
        AppState.notifDrawerOpen = true;
        DOM.notifDrawer.hidden   = false;
        DOM.notifBackdrop.hidden = false;
        DOM.notifBell.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => { DOM.notifDrawer.classList.add('open'); DOM.notifBackdrop.classList.add('visible'); });
        renderNotifDrawer();
    }

    function closeNotifDrawer() {
        AppState.notifDrawerOpen = false;
        DOM.notifDrawer.classList.remove('open');
        DOM.notifBackdrop.classList.remove('visible');
        DOM.notifBell.setAttribute('aria-expanded', 'false');
        setTimeout(() => { DOM.notifDrawer.hidden = true; DOM.notifBackdrop.hidden = true; }, 340);
    }

    function renderNotifDrawer() {
        if (!DOM.notifList) return;
        DOM.notifList.innerHTML = '';
        if (AppState.notifications.length === 0) { DOM.notifEmpty.hidden = false; return; }
        DOM.notifEmpty.hidden = true;
        AppState.notifications.forEach(notif => {
            const item = document.createElement('div');
            item.className = 'notif-item';
            item.setAttribute('role', 'listitem');
            const label   = document.createElement('p'); label.className = 'notif-label'; label.textContent = 'someone whispered on your post';
            const snippet = document.createElement('p'); snippet.className = 'notif-snippet'; snippet.textContent = `"${notif.postSnippet}"`;
            const count   = document.createElement('p'); count.className = 'notif-count'; count.textContent = notif.count === 1 ? '1 new whisper' : `${notif.count} new whispers`;
            const tapBtn  = document.createElement('button'); tapBtn.className = 'notif-tap-btn'; tapBtn.textContent = 'tap to view →';
            tapBtn.setAttribute('aria-label', `Jump to: ${notif.postSnippet}`);
            tapBtn.addEventListener('click', () => { closeNotifDrawer(); jumpToPost(notif.postId); });
            item.appendChild(label); item.appendChild(snippet); item.appendChild(count); item.appendChild(tapBtn);
            DOM.notifList.appendChild(item);
        });
    }

    function jumpToPost(postId) {
        AppState.newReplies.delete(postId);
        AppState.notifications = AppState.notifications.filter(n => n.postId !== postId);
        updateBell();
        AppState.openWhisperPostId = postId;
        renderPosts();
        requestAnimationFrame(() => {
            const card = DOM.open.feed.querySelector(`.post-card[data-id="${postId}"]`);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    // ════════════════════════════════════════════════════════
    // FEED REFRESH
    // ════════════════════════════════════════════════════════
    function showNewPostsPill() {
        const n = AppState.queuedPosts.length;
        if (!DOM.open.newPostsPill || n === 0) return;
        DOM.open.newPostsPillText.textContent = `↑ ${n} new post${n !== 1 ? 's' : ''}`;
        DOM.open.newPostsPill.hidden = false;
    }
    function hideNewPostsPill() {
        if (!DOM.open.newPostsPill) return;
        DOM.open.newPostsPill.hidden = true;
        AppState.queuedPosts = [];
    }
    function flushQueuedPosts() {
        if (AppState.queuedPosts.length === 0) return;
        // queuedPosts is newest-first (each was unshift'd as it arrived).
        // Merge: queued posts go to the top, maintaining their newest-first order.
        // Dedup by id in case a post arrived via socket AND was already in AppState.posts.
        const existingIds = new Set(AppState.posts.map(p => p.id));
        const fresh = AppState.queuedPosts.filter(p => !existingIds.has(p.id));
        // fresh[0] is the newest — keep that order at the top
        AppState.posts = [...fresh, ...AppState.posts];
        hideNewPostsPill();   // also clears queuedPosts
        renderPosts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function ptrStart(clientY) {
        if (window.scrollY !== 0 || AppState.isLoading || AppState.ptrRefreshing) return;
        AppState.ptrActive = true; AppState.ptrStartY = clientY; AppState.ptrDelta = 0;
    }
    function ptrMove(clientY) {
        if (!AppState.ptrActive) return;
        const raw = clientY - AppState.ptrStartY;
        if (raw <= 0 || window.scrollY > 0) { ptrCancel(); return; }
        AppState.ptrDelta = raw;
        const shift    = Math.min(CONFIG.PTR_MAX_SHIFT, raw * 0.45);
        const progress = Math.min(1, raw / CONFIG.PTR_THRESHOLD);
        if (DOM.open.ptrIndicator) {
            DOM.open.ptrIndicator.style.transform = `translateY(${shift}px)`;
            DOM.open.ptrIndicator.style.opacity   = String(progress);
            if (DOM.open.ptrLabel) DOM.open.ptrLabel.textContent = progress >= 1 ? 'release to refresh' : 'pull to refresh';
        }
        if (DOM.open.feed) DOM.open.feed.style.transform = `translateY(${shift * 0.35}px)`;
    }
    function ptrEnd() {
        if (!AppState.ptrActive) return;
        const delta = AppState.ptrDelta; ptrCancel();
        if (delta >= CONFIG.PTR_THRESHOLD) triggerPullRefresh();
    }
    function ptrCancel() {
        AppState.ptrActive = false; AppState.ptrStartY = 0; AppState.ptrDelta = 0;
        if (DOM.open.ptrIndicator) { DOM.open.ptrIndicator.style.transform = ''; DOM.open.ptrIndicator.style.opacity = ''; if (DOM.open.ptrLabel) DOM.open.ptrLabel.textContent = 'pull to refresh'; }
        if (DOM.open.feed) DOM.open.feed.style.transform = '';
    }
    async function triggerPullRefresh() {
        if (AppState.ptrRefreshing) return;
        AppState.ptrRefreshing = true;
        if (DOM.open.ptrIndicator) { if (DOM.open.ptrLabel) DOM.open.ptrLabel.textContent = '🌙 refreshing…'; DOM.open.ptrIndicator.style.opacity = '1'; DOM.open.ptrIndicator.style.transform = `translateY(${CONFIG.PTR_MAX_SHIFT * 0.6}px)`; }
        hideNewPostsPill();
        await loadPosts();
        showToast('refreshed ✓', 2000);
        if (DOM.open.ptrIndicator) { DOM.open.ptrIndicator.style.transform = ''; DOM.open.ptrIndicator.style.opacity = ''; if (DOM.open.ptrLabel) DOM.open.ptrLabel.textContent = 'pull to refresh'; }
        if (DOM.open.feed) DOM.open.feed.style.transform = '';
        AppState.ptrRefreshing = false;
    }

    // ════════════════════════════════════════════════════════
    // REPORT POSTS
    // ════════════════════════════════════════════════════════
    function openPostMenu(postId) {
        closePostMenu(); // close any existing one
        AppState.activeMenuPostId = postId;
        const card = DOM.open.feed.querySelector(`.post-card[data-id="${postId}"]`);
        if (!card) return;
        const menuBtn = card.querySelector('.post-menu-btn');
        if (!menuBtn) return;

        const dropdown = document.createElement('div');
        dropdown.className = 'post-menu-dropdown';
        dropdown.setAttribute('role', 'menu');
        dropdown.dataset.menuFor = postId;

        const myUserId = getUserId();
        const post = AppState.posts.find(p => p.id === postId);

        // Share option
        const shareItem = document.createElement('button');
        shareItem.className = 'post-menu-item';
        shareItem.setAttribute('role', 'menuitem');
        shareItem.textContent = '📸 share';
        shareItem.addEventListener('click', () => { closePostMenu(); sharePostAsImage(postId); });
        dropdown.appendChild(shareItem);

        // Hide option
        const hideItem = document.createElement('button');
        hideItem.className = 'post-menu-item';
        hideItem.setAttribute('role', 'menuitem');
        hideItem.textContent = '🙈 hide from my feed';
        hideItem.addEventListener('click', () => {
            closePostMenu();
            AppState.hiddenPosts.add(postId);
            const c = DOM.open.feed.querySelector(`.post-card[data-id="${postId}"]`);
            if (c) { c.style.opacity = '0'; c.style.transform = 'translateY(-8px)'; setTimeout(() => c.remove(), 300); }
        });
        dropdown.appendChild(hideItem);

        // Report option — only if not own post
        if (!post || post.userId !== myUserId) {
            const reportItem = document.createElement('button');
            reportItem.className = 'post-menu-item';
            reportItem.setAttribute('role', 'menuitem');
            if (AppState.reportedPosts.has(postId)) {
                reportItem.textContent = '✓ reported';
                reportItem.disabled = true;
                reportItem.classList.add('reported');
            } else {
                reportItem.textContent = '🚩 report';
                reportItem.addEventListener('click', () => { closePostMenu(); openReportPicker(postId); });
            }
            dropdown.appendChild(reportItem);
        }

        card.appendChild(dropdown);
        menuBtn.setAttribute('aria-expanded', 'true');

        // Close on outside click (deferred so this click doesn't immediately close)
        requestAnimationFrame(() => {
            document.addEventListener('click', onClickOutsideMenu, { once: true, capture: true });
        });
    }

    function onClickOutsideMenu(e) {
        const dropdown = document.querySelector('.post-menu-dropdown');
        if (dropdown && !dropdown.contains(e.target)) closePostMenu();
        else if (dropdown) document.addEventListener('click', onClickOutsideMenu, { once: true, capture: true });
    }

    function closePostMenu() {
        const existing = document.querySelector('.post-menu-dropdown');
        if (existing) {
            const card = existing.closest('.post-card');
            if (card) {
                const btn = card.querySelector('.post-menu-btn');
                if (btn) btn.setAttribute('aria-expanded', 'false');
            }
            existing.remove();
        }
        AppState.activeMenuPostId = null;
    }

    function openReportPicker(postId) {
        AppState.reportPickerPostId = postId;
        DOM.reportPicker.hidden  = false;
        DOM.reportBackdrop.hidden = false;
        requestAnimationFrame(() => {
            DOM.reportPicker.classList.add('open');
            DOM.reportBackdrop.classList.add('visible');
        });
    }

    function closeReportPicker() {
        AppState.reportPickerPostId = null;
        DOM.reportPicker.classList.remove('open');
        DOM.reportBackdrop.classList.remove('visible');
        setTimeout(() => { DOM.reportPicker.hidden = true; DOM.reportBackdrop.hidden = true; }, 300);
    }

    async function submitReport(postId, reason) {
        closeReportPicker();
        try {
            const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-spoof-mode': AppState.isSpoofMode },
                body: JSON.stringify({ reason }),
                signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
                AppState.reportedPosts.add(postId);
                safeVibrate([30, 50, 30]);
                showPoeticToast('thanks. we heard you.');
                // Fade out the card
                const card = DOM.open.feed.querySelector(`.post-card[data-id="${postId}"]`);
                if (card) { card.style.transition = 'opacity 0.8s ease, transform 0.8s ease'; card.style.opacity = '0'; card.style.transform = 'translateY(-6px)'; setTimeout(() => card.remove(), 800); }
            } else if (res.status === 429) {
                showPoeticToast('you already reported this.');
            } else {
                showToast('could not submit report');
            }
        } catch (e) {
            showToast('connection error');
        }
    }

    // ════════════════════════════════════════════════════════
    // SHARE POST AS IMAGE
    // ════════════════════════════════════════════════════════
    async function sharePostAsImage(postId) {
        const card = DOM.open.feed.querySelector(`.post-card[data-id="${postId}"]`);
        if (!card) return;
        if (typeof html2canvas === 'undefined') { showToast('share not available yet'); return; }

        // Hide elements that should not appear in the screenshot
        const hideEls = card.querySelectorAll('.post-menu-btn, .heartbeat-dot, .post-actions');
        hideEls.forEach(el => { el.dataset.prevDisplay = el.style.display || ''; el.style.display = 'none'; });

        try {
            const canvas = await html2canvas(card, {
                backgroundColor: '#12121a',
                scale: 2,
                useCORS: true,
                logging: false,
            });

            // Watermark
            const ctx = canvas.getContext('2d');
            ctx.font = `${Math.round(canvas.width * 0.025)}px monospace`;
            ctx.fillStyle = 'rgba(148,148,184,0.5)';
            ctx.textAlign = 'right';
            ctx.fillText('3am • gone at 6', canvas.width - 16, canvas.height - 12);

            canvas.toBlob(async (blob) => {
                const file = new File([blob], '3am-post.png', { type: 'image/png' });
                let shared = false;
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try { await navigator.share({ files: [file] }); shared = true; } catch (e) { /* user cancelled or unsupported */ }
                }
                if (!shared) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = '3am-post.png'; a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
                showToast('captured. share it before it disappears.');
            }, 'image/png');
        } catch (e) {
            showToast('could not capture post');
        } finally {
            hideEls.forEach(el => { el.style.display = el.dataset.prevDisplay || ''; delete el.dataset.prevDisplay; });
        }
    }

    // ════════════════════════════════════════════════════════
    // API CALLS
    // ════════════════════════════════════════════════════════
    async function loadPosts() {
        try {
            AppState.isLoading = true;
            showFeedLoading(true);
            const params = AppState.activeMoodFilter ? `?mood=${encodeURIComponent(AppState.activeMoodFilter)}` : '';
            const res = await fetch(`/api/posts${params}`, {
                headers: { 'x-spoof-mode': AppState.isSpoofMode },
                signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
                AppState.posts = await res.json();
            } else if (res.status === 403) {
                AppState.posts = [];
            } else {
                throw new Error(`Server error: ${res.status}`);
            }
        } catch (e) {
            if (AppState.posts.length === 0) showToast('Could not load posts. Check your connection.');
        } finally {
            AppState.isLoading = false;
            showFeedLoading(false);
            renderPosts();
        }
    }

    async function addPost(content, isAnonymous) {
        if (AppState.isPosting) return;
        AppState.isPosting = true;
        DOM.open.postButton.disabled = true;
        DOM.open.postButton.classList.add('loading');

        // Stop typing indicator on post
        emitTypingStop();
        if (AppState.typingStopTimer) clearTimeout(AppState.typingStopTimer);

        try {
            const res = await fetch('/api/posts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-spoof-mode': AppState.isSpoofMode },
                body: JSON.stringify({ content, isAnonymous, userId: getUserId(), mood: (AppState.selectedMood && AppState.selectedMood !== '__custom__') ? AppState.selectedMood : null }),
                signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
                safeVibrate(50);
                showToast('shared to the night ✨');
                DOM.open.postInput.value = '';
                updateCharCount(0);
                setSelectedMood(null);
            } else if (res.status === 429) {
                showPoeticToast('easy. that\'s enough for tonight.');
            } else if (res.status === 403) {
                showToast('channel is now closed');
            } else {
                const data = await res.json().catch(() => ({}));
                showToast(data.error?.message || 'could not share');
            }
        } catch (e) {
            showToast(e.name === 'TimeoutError' ? 'request timed out' : 'connection error');
        } finally {
            AppState.isPosting = false;
            DOM.open.postButton.classList.remove('loading');
            handlePostInput();
        }
    }

    async function addReaction(postId, emoji) {
        try {
            const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/react`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-spoof-mode': AppState.isSpoofMode },
                body: JSON.stringify({ emoji, userId: getUserId() }),
                signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
                safeVibrate(30);
            } else if (res.status === 429) {
                showPoeticToast('you already felt that.');
            } else {
                const data = await res.json().catch(() => ({}));
                showToast(data.error?.message || 'could not react');
            }
        } catch (e) { /* optimistic update already applied */ }
    }

    async function addReply(postId, content, mood) {
        AppState.replyingPostIds.add(postId);
        updateWhisperUI(postId);
        try {
            const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-spoof-mode': AppState.isSpoofMode },
                body: JSON.stringify({ content, userId: getUserId(), mood: mood || null }),
                signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
                safeVibrate(40);
                showToast('whisper sent 💬');
                const updatedPost = await res.json();
                const idx = AppState.posts.findIndex(p => p.id === updatedPost.id);
                if (idx > -1) AppState.posts[idx] = updatedPost;
                renderPosts();
            } else if (res.status === 429) {
                showPoeticToast('slow down. take a breath.');
            } else if (res.status === 403) {
                const data = await res.json().catch(() => ({}));
                const atPersonalLimit = data.error?.message?.includes('your 3 whisper limit');
                showPoeticToast(atPersonalLimit ? "you've said enough on this one." : 'this post is full.');
            } else {
                const data = await res.json().catch(() => ({}));
                showToast(data.error?.message || 'could not whisper');
            }
        } catch (e) {
            showToast(e.name === 'TimeoutError' ? 'request timed out' : 'connection error');
        } finally {
            AppState.replyingPostIds.delete(postId);
        }
    }

    // ════════════════════════════════════════════════════════
    // MOOD PICKER
    // ════════════════════════════════════════════════════════
    function setSelectedMood(mood) {
        AppState.selectedMood = mood;
        if (!DOM.open.moodPicker) return;
        DOM.open.moodPicker.querySelectorAll('.mood-pill').forEach(btn => {
            const active = btn.dataset.mood === mood;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active);
        });
        // Always reset custom pill to its placeholder state when a preset
        // is selected OR when mood is null (post submitted, mood cleared)
        const customPill = DOM.open.moodPicker.querySelector('.mood-pill-custom');
        if (customPill && mood !== '__custom__') {
            const input = customPill.querySelector('.mood-custom-input');
            const label = customPill.querySelector('.mood-pill-label');
            if (input) { input.value = ''; input.style.display = 'none'; }
            if (label) { label.textContent = CONFIG.CUSTOM_MOOD_PLACEHOLDER; label.style.display = ''; }
            customPill.classList.remove('active');
            customPill.setAttribute('aria-pressed', false);
        }
    }

    function renderMoodPicker() {
        if (!DOM.open.moodPicker) return;
        DOM.open.moodPicker.innerHTML = '';
        CONFIG.MOODS.forEach(mood => {
            const btn = document.createElement('button');
            btn.className = 'mood-pill'; btn.dataset.mood = mood;
            btn.setAttribute('aria-pressed', 'false'); btn.setAttribute('aria-label', `Set mood: ${mood}`);
            const emoji = document.createElement('span'); emoji.className = 'mood-pill-emoji'; emoji.setAttribute('aria-hidden', 'true'); emoji.textContent = CONFIG.MOOD_EMOJIS[mood];
            const label = document.createElement('span'); label.className = 'mood-pill-label'; label.textContent = mood;
            btn.appendChild(emoji); btn.appendChild(label);
            DOM.open.moodPicker.appendChild(btn);
        });

        // ── "✏️ other..." custom mood pill ──────────────────────
        const customBtn = document.createElement('button');
        customBtn.className = 'mood-pill mood-pill-custom';
        customBtn.dataset.mood = '__custom__';
        customBtn.setAttribute('aria-pressed', 'false');
        customBtn.setAttribute('aria-label', 'Enter a custom mood');

        const customLabel = document.createElement('span');
        customLabel.className = 'mood-pill-label';
        customLabel.textContent = CONFIG.CUSTOM_MOOD_PLACEHOLDER;

        const customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.className = 'mood-custom-input';
        customInput.maxLength = 20;
        customInput.placeholder = 'your mood…';
        customInput.setAttribute('aria-label', 'Type a custom mood');
        customInput.style.display = 'none';

        customBtn.appendChild(customLabel);
        customBtn.appendChild(customInput);
        DOM.open.moodPicker.appendChild(customBtn);

        customBtn.addEventListener('click', (e) => {
            if (e.target === customInput) return; // let input handle its own clicks
            // Toggle: if already custom-active, deselect
            if (AppState.selectedMood === '__custom__' && !customInput.value.trim()) {
                AppState.selectedMood = null;
                customInput.style.display = 'none';
                customLabel.style.display = '';
                customBtn.classList.remove('active');
                customBtn.setAttribute('aria-pressed', false);
                return;
            }
            // Activate: show input, hide label text
            customLabel.style.display = 'none';
            customInput.style.display = '';
            customBtn.classList.add('active');
            customBtn.setAttribute('aria-pressed', true);
            // Deselect any preset
            DOM.open.moodPicker.querySelectorAll('.mood-pill:not(.mood-pill-custom)').forEach(b => {
                b.classList.remove('active'); b.setAttribute('aria-pressed', false);
            });
            AppState.selectedMood = customInput.value.trim() || '__custom__';
            setTimeout(() => customInput.focus(), 0);
        });

        customInput.addEventListener('input', () => {
            const val = customInput.value.trim().slice(0, 20);
            AppState.selectedMood = val || '__custom__';
        });

        customInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); customInput.blur(); }
            e.stopPropagation(); // prevent textarea keydown from firing
        });

        customInput.addEventListener('blur', () => {
            const val = customInput.value.trim();
            if (!val) {
                // Empty — revert to placeholder label, deselect
                customInput.style.display = 'none';
                customLabel.style.display = '';
                customBtn.classList.remove('active');
                customBtn.setAttribute('aria-pressed', false);
                AppState.selectedMood = null;
            } else {
                AppState.selectedMood = val;
                customLabel.textContent = val;
                customLabel.style.display = '';
                customInput.style.display = 'none';
                customBtn.classList.add('active');
            }
        });
    }

    function renderMoodFilterBar() {
        if (!DOM.open.moodFilterBar) return;
        DOM.open.moodFilterBar.innerHTML = '';
        const allBtn = document.createElement('button');
        allBtn.className = 'mood-filter-pill' + (AppState.activeMoodFilter === null ? ' active' : '');
        allBtn.textContent = 'All'; allBtn.setAttribute('aria-pressed', AppState.activeMoodFilter === null); allBtn.setAttribute('aria-label', 'Show all posts');
        allBtn.addEventListener('click', () => { AppState.activeMoodFilter = null; loadPosts(); renderMoodFilterBar(); });
        DOM.open.moodFilterBar.appendChild(allBtn);
        CONFIG.MOODS.forEach(mood => {
            const btn = document.createElement('button');
            btn.className = 'mood-filter-pill' + (AppState.activeMoodFilter === mood ? ' active' : '');
            btn.setAttribute('aria-pressed', AppState.activeMoodFilter === mood); btn.setAttribute('aria-label', `Filter by ${mood}`);
            const em = document.createElement('span'); em.setAttribute('aria-hidden', 'true'); em.textContent = CONFIG.MOOD_EMOJIS[mood] + ' ';
            btn.appendChild(em); btn.appendChild(document.createTextNode(mood));
            btn.addEventListener('click', () => { AppState.activeMoodFilter = mood; loadPosts(); renderMoodFilterBar(); });
            DOM.open.moodFilterBar.appendChild(btn);
        });
    }

    // ════════════════════════════════════════════════════════
    // WHISPER THREAD
    // ════════════════════════════════════════════════════════
    function updateWhisperUI(postId) {
        const card = DOM.open.feed.querySelector(`.post-card[data-id="${postId}"]`);
        if (!card) return;
        const ws = card.querySelector('.whisper-section');
        if (ws) { const post = AppState.posts.find(p => p.id === postId); if (post) ws.replaceWith(buildWhisperSection(post, getUserId())); }
    }

    function buildWhisperSection(post, userId) {
        const section = document.createElement('div');
        section.className = 'whisper-section';
        const isOpen = AppState.openWhisperPostId === post.id;
        section.classList.toggle('open', isOpen);
        if (!isOpen) return section;

        if (post.replies && post.replies.length > 0) {
            const list = document.createElement('div'); list.className = 'whisper-list';
            post.replies.forEach(reply => {
                const item = document.createElement('div'); item.className = 'whisper-item';
                if (reply.mood) {
                    const mt = document.createElement('span');
                    mt.className = `whisper-mood mood-tag mood-${reply.mood.replace(/[^a-z]/g, '-')}`;
                    mt.textContent = `${CONFIG.MOOD_EMOJIS[reply.mood] || ''} ${reply.mood}`;
                    item.appendChild(mt);
                }
                const c = document.createElement('p'); c.className = 'whisper-content'; c.textContent = reply.content;
                item.appendChild(c); list.appendChild(item);
            });
            section.appendChild(list);
        } else {
            const empty = document.createElement('p'); empty.className = 'whisper-empty'; empty.textContent = 'no whispers yet.';
            section.appendChild(empty);
        }

        const userReplyCount = post.replies ? post.replies.filter(r => r.userId === userId).length : 0;
        const alreadyReplied = userReplyCount >= 3;
        const atLimit        = post.replies && post.replies.length >= 3;
        const isReplying     = AppState.replyingPostIds.has(post.id);

        if (!atLimit && !alreadyReplied) {
            const inputArea = document.createElement('div'); inputArea.className = 'whisper-input-area';
            const replyMoodPicker = document.createElement('div'); replyMoodPicker.className = 'whisper-mood-picker'; replyMoodPicker.dataset.postId = post.id; replyMoodPicker.dataset.selectedMood = '';
            CONFIG.MOODS.forEach(mood => {
                const mp = document.createElement('button'); mp.className = 'whisper-mood-pill'; mp.dataset.mood = mood;
                mp.setAttribute('aria-label', mood); mp.setAttribute('aria-pressed', 'false'); mp.textContent = CONFIG.MOOD_EMOJIS[mood];
                replyMoodPicker.appendChild(mp);
            });
            const inputRow = document.createElement('div'); inputRow.className = 'whisper-input-row';
            const textarea = document.createElement('textarea'); textarea.className = 'whisper-textarea'; textarea.placeholder = 'whisper something...';
            textarea.rows = 1; textarea.setAttribute('aria-label', 'Write a whisper reply');
            // No maxLength — soft limit only
            const sendBtn = document.createElement('button'); sendBtn.className = 'whisper-send-btn'; sendBtn.setAttribute('aria-label', 'Send whisper'); sendBtn.disabled = isReplying; sendBtn.textContent = isReplying ? '…' : '↑';
            sendBtn.addEventListener('click', () => { const c = textarea.value.trim(); if (!c) return; addReply(post.id, c, replyMoodPicker.dataset.selectedMood || null); });
            textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); } });
            textarea.addEventListener('input', () => { textarea.style.height = 'auto'; textarea.style.height = textarea.scrollHeight + 'px'; });
            replyMoodPicker.addEventListener('click', (e) => {
                const pill = e.target.closest('.whisper-mood-pill'); if (!pill) return;
                const mood = pill.dataset.mood; const newMood = replyMoodPicker.dataset.selectedMood === mood ? '' : mood;
                replyMoodPicker.dataset.selectedMood = newMood;
                replyMoodPicker.querySelectorAll('.whisper-mood-pill').forEach(p => { p.classList.toggle('active', p.dataset.mood === newMood); p.setAttribute('aria-pressed', p.dataset.mood === newMood); });
            });
            inputRow.appendChild(textarea); inputRow.appendChild(sendBtn);
            inputArea.appendChild(replyMoodPicker); inputArea.appendChild(inputRow);
            section.appendChild(inputArea);
        } else if (atLimit) {
            const msg = document.createElement('p'); msg.className = 'whisper-limit'; msg.textContent = 'this post is full.'; section.appendChild(msg);
        } else if (alreadyReplied) {
            const msg = document.createElement('p'); msg.className = 'whisper-limit'; msg.textContent = "you've whispered 3 times here. that's your limit."; section.appendChild(msg);
        }
        return section;
    }

    // ════════════════════════════════════════════════════════
    // RENDERING
    // ════════════════════════════════════════════════════════
    function switchScreen(name) {
        Object.values(DOM.screens).forEach(s => s.classList.remove('active'));
        DOM.screens[name].classList.add('active');
        AppState.current = name;
        // Starfield runs on closed/opening screens; pauses when app is open (perf)
        if (window.__starfield) {
            if (name === 'open') window.__starfield.stop();
            else                 window.__starfield.start();
        }
    }

    function renderClosedScreen() {
        const now = getTrustedTime().time;
        DOM.closed.countdown.textContent = formatCountdown(getNextOpeningTime(now) - now);
        DOM.closed.timezone.textContent  = AppState.timezone || 'Unknown';
    }
    function renderOpeningScreen() { DOM.opening.minutesUntil.textContent = getMinutesUntilOpen(getTrustedTime().time); }

    function renderOpenScreen() {
        const now = getTrustedTime().time;
        DOM.open.currentTime.textContent   = formatTimeShort(now);
        // In spoof/dev mode the real close time may already be past (e.g. 2 PM)
        // Show a placeholder so the UI doesn't say "closing…" while testing.
        if (AppState.isSpoofMode) {
            const minsLeft = getMinutesUntilClose(now);
            DOM.open.timeRemaining.textContent = minsLeft > 0
                ? `${minsLeft} minute${minsLeft !== 1 ? 's' : ''} remaining`
                : 'dev mode — open all day 🛠';
        } else {
            const minsLeft = getMinutesUntilClose(now);
            DOM.open.timeRemaining.textContent = minsLeft > 0
                ? `${minsLeft} minute${minsLeft !== 1 ? 's' : ''} remaining`
                : 'closing…';
        }
        DOM.open.postCount.textContent = `${AppState.posts.length} post${AppState.posts.length !== 1 ? 's' : ''}`;
        checkExitRitual(now);
    }

    function showFeedLoading(show) {
        if (DOM.open.feedLoading) DOM.open.feedLoading.style.display = show ? 'flex' : 'none';
    }

    function renderPosts() {
        if (AppState.isLoading) return;
        const userId    = getUserId();
        const heartbeat = getHeartbeatStyle(getTrustedTime().time);
        DOM.open.feed.innerHTML = '';
        const visible = AppState.posts.filter(p => !AppState.hiddenPosts.has(p.id));
        if (visible.length === 0) {
            DOM.open.emptyFeed.classList.add('active');
        } else {
            DOM.open.emptyFeed.classList.remove('active');
            visible.forEach(post => DOM.open.feed.appendChild(createPostElement(post, new Date(post.timestamp), userId, heartbeat)));
        }
    }

    function createPostElement(post, postDate, userId, heartbeat) {
        const article = document.createElement('article');
        article.className = 'post-card';
        article.dataset.id = post.id;

        if (post.userId === userId && AppState.newReplies.has(post.id)) article.classList.add('has-new-reply');

        // Heartbeat dot
        const hbDot = document.createElement('span'); hbDot.className = 'heartbeat-dot'; hbDot.setAttribute('aria-hidden', 'true');
        hbDot.style.setProperty('--pulse-duration', `${heartbeat.pulseDuration}s`);
        hbDot.style.setProperty('--pulse-color', heartbeat.color);
        article.appendChild(hbDot);

        // ··· menu button (top-right)
        const menuBtn = document.createElement('button');
        menuBtn.className = 'post-menu-btn'; menuBtn.setAttribute('aria-label', 'Post options'); menuBtn.setAttribute('aria-haspopup', 'true'); menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.textContent = '···';
        menuBtn.addEventListener('click', (e) => { e.stopPropagation(); AppState.activeMenuPostId === post.id ? closePostMenu() : openPostMenu(post.id); });
        article.appendChild(menuBtn);

        // Header
        const header = document.createElement('div'); header.className = 'post-header';
        const meta   = document.createElement('div'); meta.className = 'post-meta';
        if (post.isKept) { const kb = document.createElement('span'); kb.className = 'kept-badge'; kb.textContent = '✨ Kept'; kb.title = 'This post survived the nightly cleanup'; meta.appendChild(kb); }
        const timeEl = document.createElement('span'); timeEl.className = 'post-time'; timeEl.textContent = formatTime(postDate); timeEl.title = postDate.toLocaleString();
        const author = document.createElement('span');
        author.className = 'post-anonymous';
        if (post.isAnonymous) {
            author.textContent = 'anonymous';
        } else {
            // Show soul ID: use post's userId if it's the viewer's own post,
            // or a generic tag for others (we don't expose other users' IDs)
            const myId = getUserId();
            author.textContent = post.userId === myId ? getSoulId() : 'a soul';
            author.className = 'post-anonymous' + (post.userId === myId ? ' post-soul-id' : '');
        }
        meta.appendChild(timeEl); meta.appendChild(author);
        if (post.mood) {
            const mt = document.createElement('span'); mt.className = `mood-tag mood-${post.mood.replace(/[^a-z]/g, '-')}`; mt.setAttribute('aria-label', `Mood: ${post.mood}`); mt.textContent = `${CONFIG.MOOD_EMOJIS[post.mood] || ''} ${post.mood}`;
            header.appendChild(mt);
        }
        header.appendChild(meta);

        // Content
        const content = document.createElement('div'); content.className = 'post-content'; content.textContent = post.content;

        // Actions
        const actions = document.createElement('div'); actions.className = 'post-actions';
        CONFIG.REACTIONS.forEach(emoji => {
            const btn = document.createElement('button'); btn.className = 'reaction-btn'; btn.dataset.emoji = emoji; btn.setAttribute('aria-label', `React with ${emoji}`); btn.title = emoji;
            const es = document.createElement('span'); es.className = 'emoji'; es.setAttribute('aria-hidden', 'true'); es.textContent = emoji;
            const cs = document.createElement('span'); cs.className = 'count';
            const arr = post.reactions[emoji]; const count = Array.isArray(arr) ? arr.length : 0; cs.textContent = count > 0 ? count : '';
            if (Array.isArray(arr) && arr.includes(userId)) { btn.classList.add('reacted'); btn.setAttribute('aria-pressed', 'true'); } else btn.setAttribute('aria-pressed', 'false');
            btn.appendChild(es); btn.appendChild(cs); actions.appendChild(btn);
        });

        const whisperCount  = post.replies ? post.replies.length : 0;
        const isWhisperOpen = AppState.openWhisperPostId === post.id;
        const hasNewReply   = post.userId === userId && AppState.newReplies.has(post.id);

        const whisperBtn = document.createElement('button');
        whisperBtn.className = 'whisper-btn' + (isWhisperOpen ? ' active' : ''); whisperBtn.dataset.action = 'whisper-toggle';
        whisperBtn.setAttribute('aria-label', `Whisper replies (${whisperCount})`); whisperBtn.setAttribute('aria-expanded', isWhisperOpen);
        const wi = document.createElement('span'); wi.setAttribute('aria-hidden', 'true'); wi.textContent = '💬';
        const wc = document.createElement('span'); wc.className = 'count'; wc.textContent = whisperCount > 0 ? whisperCount : '';
        whisperBtn.appendChild(wi); whisperBtn.appendChild(wc);
        if (hasNewReply && !isWhisperOpen) { const nb = document.createElement('span'); nb.className = 'whisper-new-badge'; nb.setAttribute('aria-label', 'new reply'); nb.textContent = 'new 💬'; whisperBtn.appendChild(nb); }
        actions.appendChild(whisperBtn);

        const whisperSection = buildWhisperSection(post, userId);
        article.appendChild(header); article.appendChild(content); article.appendChild(actions); article.appendChild(whisperSection);
        return article;
    }

    // ════════════════════════════════════════════════════════
    // CHARACTER COUNT  (soft indicator only — never blocks)
    // ════════════════════════════════════════════════════════
    function updateCharCount(length) {
        if (!DOM.open.charCount) return;
        if (length <= CONFIG.SOFT_POST_WARN) {
            DOM.open.charCount.textContent = '';
            DOM.open.charCount.className = 'char-count';
            return;
        }
        const over = length - CONFIG.SOFT_POST_WARN;
        DOM.open.charCount.textContent = `+${over}`;
        DOM.open.charCount.className   = 'char-count over' + (over > 100 ? ' over-far' : '');
    }

    // ════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ════════════════════════════════════════════════════════
    function handlePostInput() {
        const content = DOM.open.postInput.value.trim();
        DOM.open.postButton.disabled = content.length === 0 || AppState.isPosting;
        updateCharCount(DOM.open.postInput.value.length);
    }

    function handlePostSubmit() {
        const content = sanitizeInput(DOM.open.postInput.value);
        if (!content.length) return;
        addPost(content, DOM.open.anonymousCheck.checked);
    }

    function handleFeedClick(event) {
        // Close any open post menu on click outside
        const menuBtn = event.target.closest('.post-menu-btn');
        if (!menuBtn) closePostMenu();

        // Reactions
        const reactionBtn = event.target.closest('.reaction-btn');
        if (reactionBtn) {
            const card = reactionBtn.closest('.post-card'); if (!card) return;
            const postId = card.dataset.id; const emoji = reactionBtn.dataset.emoji; const userId = getUserId();
            const post = AppState.posts.find(p => p.id === postId);
            if (post) {
                const currentlyReacted = Array.isArray(post.reactions[emoji]) && post.reactions[emoji].includes(userId);
                CONFIG.REACTIONS.forEach(e => { if (Array.isArray(post.reactions[e])) post.reactions[e] = post.reactions[e].filter(id => id !== userId); });
                if (!currentlyReacted) post.reactions[emoji].push(userId);
                renderPosts();
            }
            addReaction(postId, emoji); return;
        }

        // Whisper toggle
        const whisperToggle = event.target.closest('[data-action="whisper-toggle"]');
        if (whisperToggle) {
            const card = whisperToggle.closest('.post-card'); if (!card) return;
            const postId = card.dataset.id;
            const opening = AppState.openWhisperPostId !== postId;
            AppState.openWhisperPostId = opening ? postId : null;
            if (opening && AppState.newReplies.has(postId)) {
                AppState.newReplies.delete(postId);
                AppState.notifications = AppState.notifications.filter(n => n.postId !== postId);
                updateBell();
            }
            renderPosts(); return;
        }
    }

    // ════════════════════════════════════════════════════════
    // TICK LOOP
    // ════════════════════════════════════════════════════════
    function tick() {
        const { time: now } = getTrustedTime();
        const state = getCurrentState(now);
        const shouldUpdate = state !== AppState.current || (now.getTime() - AppState.lastTimeCheck > 1000);
        if (!shouldUpdate) return;
        AppState.lastTimeCheck = now.getTime();

        switch (state) {
            case AppState.CLOSED:
                switchScreen('closed'); renderClosedScreen(); break;
            case AppState.OPENING_SOON:
                switchScreen('opening'); renderOpeningScreen(); break;
            case AppState.OPEN:
                if (AppState.current !== AppState.OPEN) {
                    switchScreen('open'); renderMoodFilterBar(); loadPosts();
                    setTimeout(() => loadAndShowGhost(), 800);
                } else { renderOpenScreen(); }
                break;
        }
    }

    // ════════════════════════════════════════════════════════
    // DEV OVERRIDE — primary: window.__DEV_OVERRIDE (synchronous, injected by server)
    //               secondary: verify via /api/status and show badge
    // ════════════════════════════════════════════════════════
    async function checkDevOverride() {
        // window.__DEV_OVERRIDE is set synchronously by /dev-config.js before this
        // script runs, so isSpoofMode is already correct by the time init() calls us.
        // We still verify server-side to catch mismatches and show the badge.
        try {
            const res = await fetch('/api/status', { signal: AbortSignal.timeout(3000) });
            if (!res.ok) return;
            const data = await res.json();
            const serverIsDevOpen = data.devOverride === true;
            if (serverIsDevOpen && !AppState.isSpoofMode) {
                // Fallback: server says dev override but our synchronous read missed it
                AppState.isSpoofMode = true;
                localStorage.setItem('3am_spoof', 'true');
            }
            if (AppState.isSpoofMode || serverIsDevOpen) {
                showDevModeBadge();
            }
        } catch (e) {
            // Silent — isSpoofMode may already be true from __DEV_OVERRIDE
            if (AppState.isSpoofMode) showDevModeBadge();
        }
    }

    function showDevModeBadge() {
        if (document.getElementById('dev-mode-badge')) return; // already shown
        const badge = document.createElement('div');
        badge.id = 'dev-mode-badge';
        badge.className = 'dev-mode-badge';
        badge.setAttribute('aria-label', 'Development mode active');
        badge.textContent = 'DEV MODE 🛠';
        document.body.appendChild(badge);
        // Also reveal the bypass button in the locked screen
        const bypassBtn = document.getElementById('bypass-btn');
        if (bypassBtn) bypassBtn.classList.add('visible');
    }

    // ════════════════════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════════════════════
    function init() {
        AppState.timezone = getTimezone();
        syncServerTime();
        setInterval(syncServerTime, CONFIG.TIME_SYNC_INTERVAL_MS);
        renderMoodPicker();
        initOnboarding();

        // Show dev badge immediately if already in spoof mode from localStorage or __DEV_OVERRIDE
        if (AppState.isSpoofMode) showDevModeBadge();

        // Socket.io
        try {
            AppState.socket = io({ reconnectionDelay: 1000, reconnectionDelayMax: 10000 });

            AppState.socket.on('connect',       () => DOM.liveIndicator.classList.add('active'));
            AppState.socket.on('disconnect',    () => DOM.liveIndicator.classList.remove('active'));
            AppState.socket.on('connect_error', () => { if (AppState.current === AppState.OPEN) loadPosts(); });

            AppState.socket.on('init', (data) => {
                if (Array.isArray(data)) AppState.posts = data;
                else if (data && data.posts) { AppState.posts = data.posts; if (data.userCount !== undefined) updateUserCount(data.userCount); }
                renderPosts();
            });

            AppState.socket.on('new_post', (post) => {
                if (AppState.posts.find(p => p.id === post.id)) return;
                if (AppState.activeMoodFilter && post.mood !== AppState.activeMoodFilter) return;
                if (isAtScrollTop()) {
                    AppState.posts.unshift(post); renderPosts();
                    if (DOM.open.postCount) DOM.open.postCount.textContent = `${AppState.posts.length} post${AppState.posts.length !== 1 ? 's' : ''}`;
                } else { AppState.queuedPosts.unshift(post); showNewPostsPill(); }
            });

            AppState.socket.on('post_updated', (updated) => {
                const idx = AppState.posts.findIndex(p => p.id === updated.id);
                // Snapshot reply count BEFORE we update the stored post
                const prevRepliesLen = idx > -1 ? (AppState.posts[idx].replies || []).length : 0;
                if (idx > -1) AppState.posts[idx] = updated;
                // Always run notification check — post may belong to us even if not loaded yet
                handleReplyNotification(updated, prevRepliesLen);
                if (idx > -1) renderPosts();
            });

            AppState.socket.on('post_deleted', ({ id }) => {
                AppState.posts = AppState.posts.filter(p => p.id !== id);
                renderPosts();
            });

            AppState.socket.on('user_count', updateUserCount);

            AppState.socket.on('someone_typing', ({ count }) => updateTypingIndicator(count));
            AppState.socket.on('typing_stopped', () => updateTypingIndicator(0));

        } catch (e) { loadPosts(); }

        setupEventListeners();

        // Start tick immediately — isSpoofMode is already set synchronously from
        // window.__DEV_OVERRIDE (injected by /dev-config.js before this script runs).
        // No need to wait for checkDevOverride; run it async in parallel for badge.
        tick();
        setInterval(tick, 500);
        checkDevOverride(); // async — just shows badge and handles edge-case mismatches
    }

    function updateUserCount(count) {
        if (DOM.userCountValue) { DOM.userCountValue.textContent = count; DOM.activeUsersContainer.classList.add('visible'); }
    }

    function setupEventListeners() {
        // Post composer
        DOM.open.postInput.addEventListener('input', () => {
            handlePostInput();
            // Typing indicator — emit start, debounce stop
            emitTypingStart();
            if (AppState.typingStopTimer) clearTimeout(AppState.typingStopTimer);
            AppState.typingStopTimer = setTimeout(() => { emitTypingStop(); AppState.typingStopTimer = null; }, CONFIG.TYPING_STOP_DEBOUNCE_MS);
        });
        DOM.open.postInput.addEventListener('blur', () => {
            emitTypingStop();
            if (AppState.typingStopTimer) { clearTimeout(AppState.typingStopTimer); AppState.typingStopTimer = null; }
        });
        DOM.open.postButton.addEventListener('click', handlePostSubmit);
        DOM.open.postInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!DOM.open.postButton.disabled) handlePostSubmit(); }
        });

        // Anonymous toggle — update "posting as" preview live
        if (DOM.open.anonymousCheck) {
            DOM.open.anonymousCheck.addEventListener('change', updatePostingAsPreview);
            updatePostingAsPreview(); // initialise on load
        }

        DOM.open.feed.addEventListener('click', handleFeedClick);

        if (DOM.open.moodPicker) {
            DOM.open.moodPicker.addEventListener('click', (e) => {
                const pill = e.target.closest('.mood-pill'); if (!pill) return;
                // Custom mood pill manages itself — skip it here
                if (pill.classList.contains('mood-pill-custom')) return;
                setSelectedMood(AppState.selectedMood === pill.dataset.mood ? null : pill.dataset.mood);
            });
        }

        // Notification bell
        if (DOM.notifBell) DOM.notifBell.addEventListener('click', () => AppState.notifDrawerOpen ? closeNotifDrawer() : openNotifDrawer());
        if (DOM.notifDrawerClose) DOM.notifDrawerClose.addEventListener('click', closeNotifDrawer);
        if (DOM.notifBackdrop)   DOM.notifBackdrop.addEventListener('click', closeNotifDrawer);

        // Report picker
        if (DOM.reportBackdrop) DOM.reportBackdrop.addEventListener('click', closeReportPicker);
        document.getElementById('report-picker-cancel')?.addEventListener('click', closeReportPicker);
        document.querySelectorAll('.report-reason-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!AppState.reportPickerPostId) return;
                submitReport(AppState.reportPickerPostId, btn.dataset.reason);
            });
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (AppState.notifDrawerOpen) closeNotifDrawer();
                if (AppState.reportPickerPostId) closeReportPicker();
                closePostMenu();
            }
        });

        // New-posts pill
        if (DOM.open.newPostsPill) DOM.open.newPostsPill.addEventListener('click', flushQueuedPosts);

        // Desktop refresh
        if (DOM.open.desktopRefreshBtn) {
            DOM.open.desktopRefreshBtn.addEventListener('click', async () => {
                DOM.open.desktopRefreshBtn.disabled = true; DOM.open.desktopRefreshBtn.textContent = '↻ refreshing…';
                hideNewPostsPill(); await loadPosts(); showToast('refreshed ✓', 2000);
                DOM.open.desktopRefreshBtn.disabled = false; DOM.open.desktopRefreshBtn.textContent = '↻ refresh';
            });
        }

        // Pull-to-refresh
        window.addEventListener('touchstart', (e) => { if (AppState.current === AppState.OPEN) ptrStart(e.touches[0].clientY); }, { passive: true });
        window.addEventListener('touchmove', (e) => {
            if (!AppState.ptrActive) return;
            ptrMove(e.touches[0].clientY);
            if (window.scrollY === 0 && AppState.ptrDelta > 0) e.preventDefault();
        }, { passive: false });
        window.addEventListener('touchend',    () => { if (AppState.ptrActive) ptrEnd(); },    { passive: true });
        window.addEventListener('touchcancel', () => { if (AppState.ptrActive) ptrCancel(); }, { passive: true });

        // Spoof mode
        let clickCount = 0, lastClick = 0;
        const moonIcon = document.querySelector('.moon-icon');
        if (moonIcon) {
            moonIcon.addEventListener('click', () => {
                const now = Date.now();
                clickCount = (now - lastClick < 500) ? clickCount + 1 : 1;
                lastClick  = now;
                if (clickCount === 3) { clickCount = 0; toggleSpoofMode(); }
            });
        }
        const bypassBtn = document.getElementById('bypass-btn');
        if (bypassBtn) {
            // Show if ?dev is in URL (set immediately). Also shown after checkDevOverride
            // runs (see showDevModeBadge — it also reveals bypass btn).
            if (window.location.search.includes('dev')) bypassBtn.classList.add('visible');
            bypassBtn.addEventListener('click', toggleSpoofMode);
        }
    }

    function toggleSpoofMode() {
        AppState.isSpoofMode = !AppState.isSpoofMode;
        localStorage.setItem('3am_spoof', AppState.isSpoofMode);
        showToast(`Dev Mode: ${AppState.isSpoofMode ? 'ON' : 'OFF'}`);
        AppState.current = null; tick();
        if (AppState.isSpoofMode) loadPosts();
    }

    // Start
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }

})();
