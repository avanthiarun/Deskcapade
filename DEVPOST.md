## What it does

**Deskcapades turns the desk in front of you into a pixel-art platformer level.** Point a camera at your desk, and every real object on it — your mug, your pencils, your phone, a can of soda — becomes a whimsical garden-castle piece in a playable side-scrolling world. Each piece appears exactly where the object sits, at the object's real size, tinted in the object's real colors. Then you run, jump, climb, swim and bounce your way across your own desk.

Rearrange your desk, and you've redesigned the level.

### Every object becomes a piece with its own behavior

Each kind of object always transforms into the same piece, from any camera angle, so players can learn the rules and *build* the level they want:

- **Pencil → wooden bridge** you can walk across
- **Pen → stone bridge**
- **Phone → rock wall with a ladder** you climb
- **Can → stone tower wrapped in a vine** you climb
- **Mug, cup, bowl or glass → a pool** you can swim in, with a ladder to climb out and a slide on the handle side
- **Eraser, dice or small cube → a bouncy mushroom**
- **Sticky note → a wobbly jello blob**: you can move through it, but slowly, and jump higher off it
- **Spoon, fork or chopsticks → a thin rail platform**
- **Knife or scissors → a row of spikes** (touch them and you respawn)
- **Eyeglasses → a river with stepping stones**: miss a stone and you splash back to the start
- **Plastic water bottle → an icy patch**: you slide, and you can't jump off ice
- **Cable or charger → a rope bridge** that sags under your weight
- **Computer mouse → a trampoline** for a big bounce
- **Keyboard → a conveyor belt** that carries you sideways
- **Desk lamp → a lantern** whose warm air floats you upward
- **Bottle, flask or thermos → a fountain geyser** that erupts every few seconds and launches you up
- **Candle → a brazier** that sets you on fire
- **Plate or saucer → slippery ice**
- **Ball, plush or toy → a bouncy berry bush**

**Objects we've never heard of still work.** If the camera sees something that isn't on the list (a stapler, a tape dispenser, a headphone case), we ask Google Gemini which existing piece it is most like, and it becomes that piece.

**The world tries to look like a real platformer, not stickers on a photo:**
- Objects that are raised off the desk rest on **floating grassy islands** with dirt undersides and hanging vines, like the platforms in Super Mario. The edges of each island are ledges you can stand on.
- Bridges, rails and rivers rest on a small island at each end.
- **The world scales with the camera:** if your camera is further back and objects look small, the player, jump height and pixel details all shrink to match, so a wide shot plays like a roomier level instead of a cramped one.
- Duplicate detections of one object (a "mug" box and a "cup" box on the same mug) are merged, so pieces don't pile on top of each other.
- Objects lying on the floor or cut off at the edge of the frame are ignored.
- A **Pixel world** switch replaces the camera picture with a fully pixel-art sky and landscape behind the pieces.

### Two game modes

**Story mode: a living level from live video.**
The camera keeps watching your desk (about 40 scans a minute), and the world reshapes itself as you move things around, while you play. Golden seeds float above your desk pieces; collect them all and the whole garden blooms with a little celebration. Pieces are tracked from scan to scan, so they glide smoothly instead of flickering when the AI briefly loses sight of something.
- **❄ Freeze:** found a setup you love? Freeze it. The picture and every piece stay exactly as they are, scanning stops, and you can keep playing that level for as long as you like. Unfreeze to go live again. Freeze works from the laptop (button or **F** key) *and* from the phone.
- **Pause** stops the game itself (button, **P** or **Esc**).

**Challenge mode: an AI-designed obstacle course around your desk.**
Snap one photo of your desk, pick a difficulty, and an AI level designer builds a full obstacle course around your real objects:
- **Easy:** generous helper ledges, no hazards, 3 coins.
- **Medium:** spike pits, moving ledges, one beetle, 5 coins.
- **Hard:** spikes *and* lava pits, crumbling ledges that fall when you stand on them, two beetles, no helper ledges, 6 coins.
- **Boss:** up to 8 hazards, moving and crumbling ledges, four beetles, 8 coins, the tightest clock.

Grab every coin, then reach the flag before the timer runs out. Fall in lava or hit spikes and you go back to the start. Stomp beetles from above, or they knock you back. Each course comes with a short intro from the AI designer, a time limit fitted to the course, and your best time per level is saved.

**Points that keep adding up:**
- Beat a course: **+5 points**
- Beat it in under half the time limit: **+10 points** ("⚡ Lightning fast!")
- Run out of time: **+0** (the course starts over)

Your running total is shown on the home screen and during Challenge, and it stays between visits.

### Your phone as the camera

Any screen in the game can use either the laptop's webcam or **your phone as a wireless camera**. Scan the QR code on the laptop, and the phone streams live video to the game. The phone also becomes a remote:
- **📸 Snap** takes the Challenge photo from the phone, so you can hold it right above your desk.
- **❄ Freeze** freezes and unfreezes Story mode. The button stays in sync with the laptop, whichever one you press.

### Play as anything, even your own stuffed animal

Pick from 10 hand-made pixel characters: Sprout, Carrot, Strawberry, Tomato, Frog, Cat, Bunny, Penguin, Mushroom and Bee. Or tap **"From a photo"**: hold up a toy, a plushie or any object to the camera. The AI identifies it ("pink stuffed pig") and draws it as a brand-new pixel character in the same cute style, with real colors from the photo and a name. It's saved so you can play as it again.

### Game feel

- **Chiptune sound effects** for jumping, coins, seeds, bounces, stomps, splashes, fire, crumbling ledges, winning and time running out.
- **Looping background music** that pauses when you pause.
- A **🔊 / 🔇** mute toggle that remembers your choice.
- A game-style interface throughout: title screen, How to Play, Credits, an About page, toasts and on-screen stats (seeds, blooms, coins, time, respawns, points).
- **Controls:** ← → to walk, Space to jump, ↑ ↓ to climb, R to respawn, P to pause, F to freeze.

### Play it from a link: everyone gets their own game

The game is hosted online, so anyone with the link can play on their own laptop and phone. Every laptop tab gets its own **private room**, and its QR code only ever connects that person's phone. Many people can play at once without seeing each other's desks.

---

## How we built it

Deskcapades is written entirely in **TypeScript**, organized as one repository with three packages (npm workspaces):

- **`client/`**: the game and every screen, built with **Vite** and drawn on a plain **HTML5 Canvas**. There's no game engine: we wrote our own physics, collision, rendering and pixel-art drawing.
- **`server/`**: a **Node.js** server using **Express** for the web API and **ws** for WebSockets. It talks to the AI services and relays the phone's live video.
- **`shared/`**: TypeScript types for every API request and WebSocket message, so the client and server always agree on data formats and the compiler catches mismatches.

**External services and libraries:**
- **Perceptron** (`/v1/detect`): object detection. Given an image, it returns a labeled box for every object.
- **Google Gemini** via the official `@google/genai` SDK (`gemini-flash-latest`, free tier). It's our AI level designer, object matcher and character artist. Every Gemini call uses **structured JSON output** with a JSON schema, so responses are machine-readable instead of free text.
- **Web Audio API**: every sound and the music are synthesized live from oscillators and noise. There are no audio files.
- **qrcode**: generates the phone pairing QR codes.
- **zod**: validates every request body on the server.
- **Render**: hosting with a public HTTPS address (browsers only allow camera access on HTTPS pages).

### The architecture, layer by layer

#### 1. Seeing the desk: camera → detection

**Laptop camera:** the browser's `getUserMedia` opens the webcam. The page grabs frames from the video, shrinks them to at most 960 px wide, encodes them as JPEG, and sends them to our server's `POST /api/scan`.

**Phone camera:** the phone page (`/phone?room=…`) opens the rear camera and streams JPEG frames over a WebSocket as compact **binary messages**: a 4-byte header with the width and height, then the image bytes. The server acknowledges each frame before the phone sends the next one. The phone automatically lowers resolution and quality on a slow connection, so the video stays live instead of lagging.

**On the server:** `/api/scan` (or the relay, for phone video) forwards the image to **Perceptron's `/v1/detect`**. For live video we use a fast mode that asks only about a fixed list of desk categories, which cuts each scan from ~12 seconds to ~4–6 seconds. Challenge photos use the slower, more detailed mode, since there's only one. With no Perceptron key configured, the server switches to a mock mode with synthetic detections, so the game can still be developed and demoed.

**Overlapping scans:** a single scan takes several seconds, too slow for "live". So in Story mode the server starts a new scan every 1.5 seconds and lets up to 4 run at the same time. Each result is numbered, and if an older scan finishes after a newer one, its result is thrown away. That gives a fresh picture of the desk about every 1.5 seconds even though each scan is slow. Scanning pauses automatically while the desk is frozen or nobody is watching.

#### 2. Cleaning up what the AI saw: `deskFilter.ts`

Raw detections are noisy, so before anything becomes a game piece we:
- drop objects lying on the floor, objects cut off by the frame edge, and background clutter (using position, size and how much of each box sits inside the desk area);
- **merge duplicate detections** of one object (high box overlap, or the same piece type mostly covering each other), keeping the larger box;
- sample each object's **real colors** from the photo, used later to tint its piece.

#### 3. Keeping it steady over time: `liveSprites.ts`

In Story mode, each new scan is matched to the objects already on screen by type and position, so a mug stays "the same mug" from scan to scan. Pieces glide smoothly to their new positions, and an object the AI misses once or twice is kept on screen briefly instead of blinking out.

#### 4. Deciding what each object becomes: `materials.ts` + `/api/match`

`materials.ts` holds the fixed list of transformations: whole-word patterns like "mug|cup|bowl|glass" → pool. Detection labels are often full descriptions ("white ceramic mug holding scissors and a pen"), so the object named *first* wins: that's the mug, not the scissors.

Objects that match nothing go to our server's **`POST /api/match`**, which asks **Gemini** to pick the closest existing piece for each unknown label (a stapler might become a rock wall). The answers are remembered, so each unknown object is only asked about once.

#### 5. Turning pieces into physics: `level.ts`

Each piece's box becomes physics geometry:
- **Surfaces:** one-way platforms you land on from above, like bridge decks, tower tops and pool rims;
- **Climb zones:** ladders, vines, rock walls;
- **Effect zones:** water, lava, jello, updrafts, conveyors, ice, geysers, fire;
- **Walls.**

This file also adds the **floating islands** under raised objects (with standable edges), and computes the **world scale** from the typical object size in the picture. Everything in the game is measured in a unit `u` (1% of screen height, times that zoom), so the player, jumps and art all scale together.

It also contains our **reachability planner**: given the player's jump height and run speed, it works out every surface you can reach from where you stand: by jumping, falling, climbing, or riding a moving ledge. It's used to guarantee courses are beatable.

#### 6. The game engine: `platformer.ts`

Our own engine runs every frame through `requestAnimationFrame`:
- **Movement:** gravity, running, jumping (with a short "coyote time" grace period after stepping off a ledge) and landings on one-way platforms.
- **Piece behaviors:** climbing, swimming, bouncing (mushroom, trampoline, berry bush), sinking slowly through jello, sliding and losing your jump on ice, being carried by conveyors, floated by lanterns, launched by geysers, set on fire by braziers.
- **Hazards:** spikes and lava send you back to the start; missing a river's stepping stones splashes you back.
- **Story:** seeds, collection, and the garden bloom when all are gathered.
- **Challenge:** coins, the goal flag, the countdown timer, moving and crumbling ledges, beetles that patrol and can be stomped, respawns, and the stats used for points.
- **Events** (win, time up) are reported back to the page, which awards points and plays sounds.

#### 7. Drawing: `pieces.ts`, `art.ts`, `pixelBackdrop.ts`

Nothing is a pre-made image. Every piece is **drawn procedurally** on a pixel grid, sized to the object and tinted with its real colors: towers, vines, pools with ladders and slides, lava basins, spike rows, arch bridges, rock faces, rope bridges, jello, rivers with stepping stones, mushrooms, berry bushes, lanterns, fountains, braziers, ice and grassy floating islands. The 10 characters are drawn from small letter grids (each letter is a color slot: outline, body, highlight, shade, eyes, blush), which is the same format Gemini uses when it draws a character from your photo. The optional pixel world (sky, clouds, hills) is drawn the same way.

#### 8. The AI level designer: `/api/course` + `course.ts`

When you pick a difficulty in Challenge mode:
1. The client sends the server the detected objects (type, position and size), the screen size, the player's jump and speed limits, and the rules for that difficulty: spacing, how many hazards and which kinds, coins, moving and crumbling ledges, beetles.
2. **`POST /api/course`** asks **Gemini** to design the course. It returns structured JSON: a start point, a goal flag, extra ledges with their style and movement, hazard pits, coin positions, beetles, a suggested time limit, and a one-line intro.
3. **We never trust the AI blindly.** `course.ts` validates the whole design with the reachability planner:
   - snaps the start and goal onto real surfaces with room above your head;
   - clamps every ledge, hazard and coin to sensible sizes and positions on screen;
   - adds stepping ledges, one row at a time, wherever the flag is out of jumping reach;
   - drops the hazards if they make the course impossible (the course itself is kept);
   - places coins only where you can actually reach them.
4. If Gemini is unavailable or its design can't be repaired, **our own built-in course designer** builds one instead, so the game always works.
5. **The time limit** is computed from the actual path length and run speed, with a factor per difficulty. Gemini's suggestion is only accepted within 1× to 2.5× of our own estimate, so it's never impossibly short.

To make sure every course is winnable, we wrote an automated **fuzz test**: it generates 800 random desks (200 desks × 4 difficulties), at both normal and zoomed-out world scales, and confirms every single one has a reachable flag with headroom.

#### 9. Characters from photos: `/api/character`

The photo is first sent to **Perceptron** to identify the object ("stuffed pig"). Then the photo and label go to **`POST /api/character`**, where **Gemini** draws the character as an 18-row, 16-column letter grid with its own color palette. We show Gemini our Sprout character as a style example. The client cleans the drawing: it forces it to exactly 18 × 16, removes unknown letters, checks there are enough filled pixels, and accepts only valid hex colors. If the drawing fails, or the AI is unavailable, you get a round-eared buddy in the object's own colors instead. The result is saved in the browser.

#### 10. The phone link: the WebSocket relay (`relay.ts`)

The phone and laptop never talk directly; both connect to our server's `/ws` WebSocket:
- **Private rooms:** each laptop tab creates a random room code. The QR code it shows contains that code (`/phone?room=…`), and the server keeps a completely separate room for each code: its own phones, laptops, latest frame, scan loop and freeze state. Rooms are cleaned up when everyone leaves.
- **Video:** phone frames are relayed to the room's laptops. A laptop that falls behind is skipped rather than queued, so video stays live.
- **Buttons:** the phone's 📸 Snap goes to that room's Challenge page. ❄ Freeze goes to the Story page, which toggles and reports its state back, so both screens always agree.
- **Status:** the server tells each side who's connected, so the phone shows "Streaming to laptop", "Waiting for laptop" or "Scan the QR code on your laptop", and only shows Snap or Freeze when they'd do something.
- **Heartbeat:** a ping every 20 seconds drops connections that died (a phone went to sleep, the Wi-Fi dropped), and the phone reconnects automatically with backoff.

#### 11. Sound: `sound.ts`

All audio is generated in code with the **Web Audio API**: square and triangle oscillators with pitch slides for jumps and coins, filtered noise bursts for splashes, fire and crumbling, and arpeggios for winning and blooming. The background music is a pentatonic chiptune melody with a bass line, scheduled slightly ahead of time on the audio clock so it keeps steady rhythm. Audio starts on the first click or key press, since browsers block sound before that.

#### 12. Points and saved progress

Points, best times per difficulty, the mute setting, custom characters and the chosen character are saved in the browser's `localStorage`. There's no account needed, and each player's progress stays on their own device.

### From laptop to the web

- **During development**, one command (`npm run dev:all`) runs the API server, the Vite dev server (with a self-signed HTTPS certificate so phones on the same Wi-Fi can use the camera), and a Cloudflare tunnel for phones on other networks.
- **For production**, `npm run build` type-checks all three packages and bundles the client, and `npm start` runs a single Node server that serves the game, the API and the WebSocket from one HTTPS address. It's deployed on **Render** from a `render.yaml` blueprint. API keys live in Render's environment settings and never in the code.

### How we built it, as a team

We started from a simple question, *"what if your desk was the level?"*, and built in layers:
1. Getting a live camera feed from a phone to a laptop.
2. Detection with Perceptron.
3. Mapping objects to pieces with physics.
4. Drawing those pieces as cohesive pixel art.
5. Gameplay on top: Story, then Challenge with an AI designer, then characters, sound, points and hosting.

We playtested constantly with real desks (mugs, pencils, phones, cans, sticky notes) and wrote automated tests for the rules that matter most: lava, ladders, rivers, ice, and courses always being beatable.
