# 3AM Channel — Manual Test Checklist

## Setup (do this first)

```bash
npm install
npm run dev
```

You should see in the terminal:
```
═══════════════════════════════════════════════════════
  ⚠️   DEV OVERRIDE ACTIVE
  Time window (3–6 AM) is BYPASSED
  All routes open. Posts are in-memory unless
  MONGODB_URI is set in .env
═══════════════════════════════════════════════════════
```

Open **http://localhost:3000** — you should see the **feed screen** immediately (not locked).

---

## Feature Test Checklist

### 0. DEV OVERRIDE
- [ ] Terminal shows the ═══ DEV OVERRIDE banner on startup
- [ ] Browser opens to **feed screen**, not locked screen
- [ ] A `DEV MODE 🛠` badge appears in the bottom-left corner
- [ ] A `bypass` button is visible on the locked screen (if you navigate there)

---

### 1. POSTING
- [ ] Textarea is present with placeholder "say what you can only say at 3am..."
- [ ] Share button is **disabled** when textarea is empty
- [ ] Share button **enables** when you type something
- [ ] Type >500 chars — counter turns purple showing "+N"
- [ ] Type >600 chars — counter turns orange-red
- [ ] Click Share → post appears in feed below
- [ ] "shared to the night ✨" toast appears
- [ ] Textarea clears after posting
- [ ] "posting as: anonymous" shows below compose when Anonymous is checked
- [ ] Uncheck Anonymous → shows "posting as: soul #xxxx" (first 4 chars of your ID)
- [ ] Post appears with "anonymous" or "soul #xxxx" tag matching the toggle
- [ ] Select a mood pill before posting → post shows mood tag

---

### 2. REACTIONS
- [ ] Each post card shows 4 reaction buttons: 😔 💀 🫂 ❤️‍🩹
- [ ] Buttons have fixed width — no layout shift/shake when clicked
- [ ] Click a reaction → button highlights green, count increments
- [ ] Click same reaction again → count decrements (toggle)
- [ ] Click different reaction → switches to new one
- [ ] Hover over button → shows native tooltip with emoji

---

### 3. WHISPER THREADS
- [ ] Each post has a whisper (reply) button
- [ ] Click whisper button → thread expands with smooth animation
- [ ] Click again → thread collapses
- [ ] Type in whisper textarea → send with ↑ button OR Enter key
- [ ] Reply appears in thread immediately
- [ ] "whisper sent 💬" toast appears
- [ ] Reply textarea auto-resizes as you type
- [ ] Post a 2nd whisper on same post → works
- [ ] Post a 3rd whisper on same post → works
- [ ] Post a 4th whisper → shows "you've said enough on this one." toast
- [ ] After 3 whispers, input area replaced with "you've whispered 3 times here. that's your limit."
- [ ] Whisper mood picker works (emoji pills above textarea)

---

### 4. MOOD TAGS
- [ ] 6 preset mood pills show below the textarea
- [ ] 7th pill shows "✏️ other..."
- [ ] Clicking a preset pill highlights it
- [ ] Clicking it again deselects it
- [ ] Clicking "✏️ other..." transforms pill into text input
- [ ] Type a custom mood (max 20 chars) → Enter or click away saves it
- [ ] Custom mood pill shows the typed text as label
- [ ] Post with custom mood → mood tag appears on post card
- [ ] Mood filter bar below "Tonight" heading shows preset moods
- [ ] Clicking a filter only shows posts with that mood
- [ ] "All" resets filter

---

### 5. GHOST POST
**Setup required first:** Seed a ghost post via:
```
curl -X POST http://localhost:3000/dev/seed-ghost
```
- [ ] Refresh the page → ghost overlay appears after ~1 second
- [ ] Shows haunting text with mood tag (if seeded with one)
- [ ] Auto-dismisses after 10 seconds OR click to dismiss
- [ ] Refresh again → does NOT show a second time (ghostShown flag)

---

### 6. HEARTBEAT INDICATOR
- [ ] Each post card has a small pulsing dot (top-right area)
- [ ] Dot is visible and animating
- [ ] In DEV mode, time is spoofed to inside the session — dot should be a medium purple speed
- [ ] Dot color: purple early in session, orange mid, red near end

---

### 7. EXIT RITUAL
*(Only testable near 6:00 AM or by temporarily changing CLOSE_HOUR to a minute ahead)*
- At 5 min before close: toast "5 minutes left. everything disappears at 6."
- At 2 min before close: toast "almost gone."
- At close time: posts fade out staggered, exit message overlay appears
- After ~4 seconds: transitions to locked screen

---

### 8. BELL NOTIFICATIONS
**Test with two browser windows (Window A = your post, Window B = whisper from someone else)**
- [ ] Window A: make a post
- [ ] Window B: open the same URL, whisper on Window A's post
- [ ] Window A: bell badge shows count "1"
- [ ] Bell shakes/animates
- [ ] Click bell → drawer opens showing "someone whispered on your post"
- [ ] Shows post snippet and "1 new whisper"
- [ ] Click "tap to view →" → drawer closes, feed scrolls to post, whisper thread opens
- [ ] Notification clears from drawer
- [ ] Badge disappears

---

### 9. NEW POSTS PILL
- [ ] Scroll down in the feed
- [ ] From a second window, create a new post
- [ ] "↑ 1 new post" pill appears at top of feed (sticky)
- [ ] Click pill → scrolls to top + new post appears in feed
- [ ] When already at top → new post injects directly, no pill

---

### 10. PULL TO REFRESH (Mobile)
- [ ] On mobile (or DevTools device mode), scroll to very top of feed
- [ ] Pull down → purple pull indicator appears with "pull to refresh" text
- [ ] Pull past threshold → changes to "release to refresh"
- [ ] Release → feed reloads, "refreshed ✓" toast appears

### Desktop Refresh Button
- [ ] Scroll to very bottom of feed
- [ ] "↻ refresh" button visible
- [ ] Click → feed reloads

---

### 11. REPORT SYSTEM
- [ ] "···" button on every post card
- [ ] Click ··· → dropdown with: 📸 share, 🙈 hide from my feed, 🚩 report
- [ ] On YOUR OWN posts: no "report" option
- [ ] Click "🙈 hide" → post fades and disappears from your feed
- [ ] Click "🚩 report" → reason picker appears (offensive, spam, harassment, other)
- [ ] Click a reason → "thanks. we heard you." toast
- [ ] On same post → ··· shows "✓ reported" (disabled)
- [ ] Click cancel → picker closes

---

### 12. ONBOARDING
- [ ] Open in **Incognito/Private** window (clears localStorage)
- [ ] Onboarding overlay appears on top
- [ ] Three slides: use → and ← arrows to navigate
- [ ] Or swipe on mobile
- [ ] "Skip" button dismisses immediately
- [ ] On slide 3, "Enter" button appears
- [ ] Click Enter → overlay dismisses, localStorage sets 3am_visited
- [ ] Refresh page → onboarding does NOT show again
- [ ] Clear localStorage manually → shows again

---

### 13. TYPING INDICATOR
- [ ] Open two browser windows side by side
- [ ] Window A: start typing in the compose area
- [ ] Window B: "someone is awake and typing..." appears above the compose area
- [ ] Window A: stop typing → indicator disappears after ~3 seconds
- [ ] Window A: submit post → indicator disappears immediately
- [ ] Window A: You do NOT see your own typing indicator

---

### 14. SHARE AS IMAGE
- [ ] Click ··· on any post
- [ ] Click "📸 share"
- [ ] On mobile: share sheet opens with PNG
- [ ] On desktop: PNG file downloads as "3am-post.png"
- [ ] Image shows post content with "3am • gone at 6" watermark
- [ ] Menu button and heartbeat dot NOT in screenshot

---

### 15. HAPTIC FEEDBACK (Mobile only)
- [ ] Post a thought → subtle vibration
- [ ] React to a post → subtle vibration
- [ ] Send a whisper → subtle vibration
- [ ] Submit a report → subtle vibration

---

### 16. RATE LIMIT MESSAGES
Test by posting rapidly or sending many requests:
- [ ] Post limit (10/night) → "easy. that's enough for tonight."
- [ ] Whisper 4x on same post → "you've said enough on this one."
- [ ] Report same post twice → "you already reported this."

---

### 17. SOUL ID / ANONYMOUS TOGGLE
- [ ] Anonymous checkbox is checked by default
- [ ] "posting as: anonymous" shown below compose
- [ ] Uncheck → "posting as: soul #xxxx" updates live
- [ ] Post with Anonymous off → post card shows "soul #xxxx"  
- [ ] Post with Anonymous on → post card shows "anonymous"
- [ ] Your soul ID is consistent across the session (first 4 chars of userId)

---

### 18. /api/status ENDPOINT
Open http://localhost:3000/api/status in browser:
- [ ] Returns JSON with `channel.isOpen: true` (because devOverride)
- [ ] `devOverride: true` in response
- [ ] `stats.activeUsers` count
- [ ] `stats.database: "memory"` (if no MongoDB URI)

---

## Quick Smoke Test (2 minutes)
1. `npm run dev` → see DEV OVERRIDE banner
2. Open http://localhost:3000 → feed screen (not locked)
3. Type something → click Share → post appears
4. Click reaction emoji → count updates, no shake
5. Click whisper button → thread opens → type reply → send
6. Open second window → whisper on your post → bell in first window shakes
7. Click bell → see notification → tap to view → scrolls to post
8. Click ··· on a post → report it → "thanks. we heard you."
9. Seed ghost: `curl -X POST localhost:3000/dev/seed-ghost` → refresh → ghost overlay
10. Open incognito → onboarding shows

If all 10 pass, the app is working ✓
