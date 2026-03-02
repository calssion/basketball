# 🌊 水中套圈 – Underwater Ring Toss

A browser-based **2.5 D / 3 D underwater ring-toss arcade game** built with [Three.js](https://threejs.org/).

---

## ▶ How to Play

Open `index.html` directly in any modern browser – no build step or server required.

| Action | Input |
|--------|-------|
| Aim | Move the mouse over the water tank |
| Charge throw | Click **and hold** (power bar fills) |
| Throw ring | Release the mouse button |
| AI trajectory | Toggle **🤖 AI 瞄准辅助** to see the predicted ring path |
| AI auto-throw | Click **🎯 AI 自动投掷** and the AI will throw for you |

---

## 🎮 Game Rules

* You have **20 rings** and **90 seconds** per round.
* Aim above the water surface and release to drop a ring into the tank.
* **Water current** drifts rings sideways – check the arrow in the HUD.
* Land a ring around a peg to score:

| Peg colour | Points |
|-----------|--------|
| 🔴 Red | 1 pt |
| 🟡 Yellow | 2 pts |
| 🔵 Blue | 3 pts |
| ⭐ Gold (centre) | 5 pts |

* **Combo multiplier** – consecutive catches stack up to **5×**.

---

## 🤖 AI Features

| Feature | Description |
|---------|-------------|
| AI Trajectory | Simulates the ring's full physics path (air + water + current) and draws it as a line |
| AI Auto-Throw | Solves the optimal aim position for the highest-value uncaught peg and throws automatically |
| Difficulty | **Easy** – weak current, small scatter · **Normal** · **Hard** – strong current, wider scatter |

---

## 🛠 Tech Stack

* **Three.js r160** – 3D scene, custom GLSL water shader, shadows, particles
* **Vanilla JS** – custom physics engine (gravity, buoyancy, water drag, collision)
* **localStorage** – high score persistence
* Zero dependencies beyond Three.js CDN – open `index.html` and play!
