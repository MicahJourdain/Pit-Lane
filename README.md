# Pit Lane

A race game that shows on a TV and is played with phones. Players and TVs can be in different houses.

## How to play

1. One person opens the game address on their phone, types a name and taps **Start a new game**. They get a four-letter code.
2. On the TV, open the game address with `/tv` on the end and type the code. Or open `your-address/tv/CODE` directly.
3. Everyone else scans the QR code on the TV, or opens the game address and types the code.
4. The host taps **Start race**.

On your turn, tap a card if you want to play it, then tap **Roll**. First to space 30 wins.

- Boost pads (+3) and oil slicks (−3) move you again when you land on them.
- **Nitro**: +3 to your roll. **Draft**: +2. **Bump**: the leader drops back 2.
- If a phone locks or refreshes, it comes back to the same seat. If a phone is gone for 15 seconds on its turn, that turn is skipped.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The phone controller |
| `tv.html` | The TV screen |
| `game.js` | The rules. Garage Table's rules go here later. |
| `server.js` | Connects phones and TVs to the rules |
| `package.json` | Tells the host what to install |
| `test-game.js` | Checks the rules (`npm test`) |

## Hosting

Runs free on Render: New Web Service → this GitHub repo → Build `npm install` → Start `npm start` → Free.
