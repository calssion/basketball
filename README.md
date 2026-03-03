# 🌊 水中投篮 – Water Basketball

A browser-based **3-D water basketball arcade game** built with [Three.js](https://threejs.org/), inspired by the classic handheld water basketball toy (水中投篮机).

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

---

## 🎮 Game Rules

* You have **20 balls** and **90 seconds** per round.
* The hoop oscillates **left and right** – time your shot carefully!
* Aim horizontally with your mouse, charge power by holding, release to shoot.
* **Water current** drifts the ball sideways – watch the arrow in the HUD.
* Score when the ball passes **upward through the hoop**:

| Shot | Points |
|------|--------|
| Clean basket | 1 pt (base) |
| 2× combo | 2 pts |
| 3× combo | 3 pts |
| 4× combo | 4 pts |
| 5× combo (max) | 5 pts ⭐ |

* **Combo multiplier** – consecutive baskets stack up to **5×**.

---

## 🤖 AI Features

| Feature | Description |
|---------|-------------|
| AI Trajectory | Simulates the ball's full physics path (buoyancy + drag + current) and draws it as a line |
| AI Auto-Shoot | Solves the optimal vx for the current hoop position and shoots automatically |
| Difficulty | **Easy** – slow hoop, small scatter · **Normal** · **Hard** – fast hoop, wider scatter |

---

## 🛠 Tech Stack

* **Three.js r160** – 3D scene, custom GLSL water shader, shadows, particles
* **Vanilla JS** – custom physics engine (gravity, buoyancy, water drag, hoop collision)
* **localStorage** – high score persistence
* Zero dependencies beyond Three.js – open `index.html` and play!
