# 🌊 水中投篮套圈 – Water Basketball & Ring Toss

A browser-based **3-D water basketball and ring toss arcade game** built with [Three.js](https://threejs.org/), inspired by the classic handheld water basketball toy (水中投篮机) and ring toss toy (水中套圈圈).

---

## ▶ How to Play

Open `index.html` directly in any modern browser – no build step or server required.

| Action | Input |
|--------|-------|
| Aim left / right | Move the mouse horizontally |
| Charge throw power | Click **and hold** (power bar fills) |
| Shoot | Release the mouse button |
| AI trajectory | Toggle **🤖 AI 瞄准辅助** to see the predicted ball path |
| AI auto-shoot | Click **🏀 AI 自动投篮** and the AI will shoot for you |
| Switch mode | Select **🏀 投篮** or **🔴 套圈** from the mode selector |

---

## 🎮 Game Modes

### 🏀 Basketball Mode
* Shoot basketballs **upward through the oscillating hoop** to score.
* The hoop moves left and right — time your shot carefully!
* Combo system: consecutive baskets stack up to **5×** multiplier.

### 🔴 Ring Toss Mode (套圈圈)
* Toss rings onto **vertical pegs** on the tank floor.
* 5 pegs with different point values:
  * Center peg: **3 pts**
  * Mid pegs: **2 pts** each
  * Side pegs: **1 pt** each
* Same combo system applies — consecutive rings on pegs multiply points!

---

## 🎮 Game Rules

* You have **20 throws** and **90 seconds** per round (both modes).
* **Water current** drifts projectiles sideways – watch the arrow in the HUD.
* Score multipliers (both modes):

| Shot | Multiplier |
|------|--------|
| 1st consecutive | 1× (base) |
| 2× combo | 2× |
| 3× combo | 3× |
| 4× combo | 4× |
| 5× combo (max) | 5× ⭐ |

---

## 🤖 AI Features

| Feature | Description |
|---------|-------------|
| AI Trajectory | Simulates the ball's full physics path (buoyancy + drag + current) and draws it as a line |
| AI Auto-Shoot | Solves the optimal vx for the current hoop position and shoots automatically |
| Difficulty | **Easy** – slow hoop, small scatter · **Normal** · **Hard** – fast hoop, wider scatter |

---

## 🎨 Visual Features

* **3D Device Frame** – A handheld toy casing surrounds the tank for an authentic retro look
* **Water Jet Effect** – Visual feedback when charging a throw
* **Bubbles, Caustics & Particles** – Underwater atmosphere with animated water surface

---

## 🛠 Tech Stack

* **Three.js r160** – 3D scene, custom GLSL water shader, shadows, particles
* **Vanilla JS** – custom physics engine (gravity, buoyancy, water drag, hoop collision)
* **localStorage** – high score persistence
* Zero dependencies beyond Three.js – open `index.html` and play!
