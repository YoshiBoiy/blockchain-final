
```
 ________  ___  ___  ________  ________  ________  ________  ___  ________
|\   __  \|\  \|\  \|\_____  \|\_____  \|\   ____\|\   __  \|\  \|\   ___  \
\ \  \|\ /\ \  \\\  \\|___/  /|\|___/  /\ \  \___|\ \  \|\  \ \  \ \  \\ \  \
 \ \   __  \ \  \\\  \   /  / /    /  / /\ \  \    \ \  \\\  \ \  \ \  \\ \  \
  \ \  \|\  \ \  \\\  \ /  /_/__  /  /_/__\ \  \____\ \  \\\  \ \  \ \  \\ \  \
   \ \_______\ \_______\\________\\________\ \_______\ \_______\ \__\ \__\\ \__\
    \|_______|\|_______|\|_______|\|_______|\|_______|\|_______|\|__|\|__| \|__|
 ________  ________  ________  ________   ___  ___      ___ ________  ___
|\   ____\|\   __  \|\   __  \|\   ___  \|\  \|\  \    /  /|\   __  \|\  \
\ \  \___|\ \  \|\  \ \  \|\  \ \  \\ \  \ \  \ \  \  /  / | \  \|\  \ \  \
 \ \  \    \ \   __  \ \   _  _\ \  \\ \  \ \  \ \  \/  / / \ \   __  \ \  \
  \ \  \____\ \  \ \  \ \  \\  \\ \  \\ \  \ \  \ \    / /   \ \  \ \  \ \  \____
   \ \_______\ \__\ \__\ \__\\ _\\ \__\\ \__\ \__\ \__/ /     \ \__\ \__\ \_______\
    \|_______|\|__|\|__|\|__|\|__|\|__| \|__|\|__|\|__|/       \|__|\|__|\|_______|
```

# Buzzcoin Carnival -- Part 2

Welcome back to the Buzzcoin Carnival! The carnival has expanded. New rides,
new games, new ways to lose your BUZZ... or make a fortune if you're clever.

You already have BUZZ from Part 1. Now it's time to spend it wisely -- or not.
The house still has terrible business sense. Every game is exploitable. Every
system has a crack. Your job is to find them.

This time around, the carnival has **three arenas**:

1. **The Carnival** -- Classic games (gambling, mining, voting, hacking)
2. **King of the Hill** -- A political war game with rebels, moles, and coups
3. **The Arbitrage Pits** -- Two DEX pools, one token pair, price differences = profit

---

## Contract Addresses

All contracts are deployed on **Sepolia testnet**.

| Contract         | Address                                      |
|------------------|----------------------------------------------|
| BuzzToken        | `0x26b7bbf61eAf8Aa9b4b6919593A3272DadE22705` |
| BuzzCarnival     | `  ` |
| KingOfTheHill    | `0xE92913e15BED6a5FC019d6EF258b2ECaB3B63845` |
| BullToken        | `0xf8c42e0E0F895ECaAAA1a7737731DbdD06861DAF` |
| BuzzSwap (DEX)   | `0xCadcEC3A21dCF45044adB463d865ce7c2B4B6971` |
| BullMarket (DEX) | `0x34272af214ae055F37eF75d948Cded8c59627448` |

---

## The Games

### Guess the Number (1 BUZZ entry)

```
                ,    _
               /|   | |
             _/_\_  >_<
            .-\-/.   |
           /  | | \_ |
           \ \| |\__(/
           /(`---')  |
          / /     \  |
       _.'  \'-'  /  |
       `----'`=-='   '
```

A wizard has a number. Guess it. If you're right, you get 5 BUZZ. If you're
wrong, you lose your entry fee and nothing happens. The number depends on your
address and the current block number. Max 20 attempts.

**Function:** `guess_the_number(uint256 nonce)`

### Duel 1v1 (1 BUZZ entry)

```
     o      _o
    <|\,/ /` |>
 ___/_>_____<_\___
```

Two players enter. One leaves with the pot. You queue up, and when a second
player joins, the contract picks a winner. The winner gets 5 BUZZ (player 1)
or 6 BUZZ (player 2 -- wait, that math doesn't add up, does it?). Max 30 duels.

**Function:** `duel1v1()`

### Duel Highroller (5 BUZZ entry)

```
           \ /
       |_O  X  O_\
        /`-/ \-'\
       | \     / |
______/___\____|_\____
```

Same as the regular duel, but higher stakes. Winner gets 10 or 12 BUZZ.
Shares the duel counter with Duel 1v1.

**Function:** `duel_highroller()`

### Pay to Mine (1 BUZZ entry)

```
                             ___
                     /======/
            ____    //      \___       ,/
             | \\  //           :,   ./
     |_______|__|_//            ;:; /
    _L_____________\o           ;;;/
____(CCCCCCCCCCCCCC)____________-/_____________
```

Proof of work, on-chain. Find a nonce such that `keccak256(nonce, your_address)`
has a certain number of trailing zero bits. Higher difficulty = bigger payout
(5 BUZZ per difficulty level above 27). Each solve must beat your previous
difficulty. First solves are easy, later ones get exponentially harder.

**Function:** `pay_to_mine(uint256 nonce, uint256 d)`

### Mayor Voting (1-100 BUZZ entry)

```
         __             _,-"~^"-.
       _// )      _,-"~`         `.
     ." ( /`"-,-"`                 ;
    / 6                             ;
   /           ,             ,-"     ;
  (,__.--.      \           /        ;
   //'   /`-.\   |          |        `._________
     _.-'_/`  )  )--...,,,___\     \-----------,)
   ((("~` _.-'.-'           __`-.   )         //
         ((("`             (((---~"`         //
                                            ((________________
                                            `----""""~~~~^^^```
```

Five players bid each round. The lowest **unique** bid wins the entire pot plus
a 5 BUZZ bonus. If your bid is duplicated by anyone else, you don't win.
Think game theory. Think coordination. Think betrayal. Max 30 rounds.

**Function:** `mayor_voting(uint256 buzzAmount)` -- amount in wei (e.g., 1 BUZZ = 1000000000000000000)

### Exploit Challenge (Free)

```
     ___________
    |  _______  |
    | |  HACK | |
    | | ME!!! | |
    | |_______| |
    |___________|
       _[___]_
      [_______]
```

There's a contract with a classic reentrancy vulnerability. Deploy an attacker
contract that re-enters during the callback to drain up to 100 BUZZ. If you
know what the DAO hack was, you know what to do.

**Function:** `exploit_challenge()`

---

## King of the Hill (V2)

```
 ___  __    ___  ________   ________          ________  ________
|\  \|\  \ |\  \|\   ___  \|\   ____\        |\   __  \|\  _____\
\ \  \/  /|\ \  \ \  \\ \  \ \  \___|        \ \  \|\  \ \  \__/
 \ \   ___  \ \  \ \  \\ \  \ \  \  ___       \ \  \\\  \ \   __\
  \ \  \\ \  \ \  \ \  \\ \  \ \  \|\  \       \ \  \\\  \ \  \_|
   \ \__\\ \__\ \__\ \__\\ \__\ \_______\       \ \_______\ \__\
    \|__| \|__|\|__|\|__| \|__|\|_______|        \|_______|\|__|

 ___________  ___  ___  _______           ___  ___  ___  ___       ___
|\___   ___\|\  \|\  \|\  ___ \         |\  \|\  \|\  \|\  \     |\  \
\|___ \  \_\ \  \\\  \ \   __/|        \ \  \\\  \ \  \ \  \    \ \  \
     \ \  \ \ \   __  \ \  \_|/__       \ \   __  \ \  \ \  \    \ \  \
      \ \  \ \ \  \ \  \ \  \_|\ \       \ \  \ \  \ \  \ \  \____\ \  \____
       \ \__\ \ \__\ \__\ \_______\       \ \__\ \__\ \__\ \_______\ \_______\
        \|__|  \|__|\|__|\|_______|        \|__|\|__|\|__|\|_______|\|_______|

```

KOTHf is a **political war game**. One player is the King. Everyone else can
either support the King, rebel against them, or play both sides.

> **Note:** All KOTH fees and parameters (coup cost, quorum, heartbeat intervals,
> etc.) may be adjusted by the instructor during the game to keep things
> interesting. Check the contract's public variables for current values.

### How it Works

**Becoming King:**
- Call `KOTH_coup()` to seize the throne. Currently costs **20 BUZZ** (flat).
  The instructor may raise this as the game progresses.
- When you coup, the previous king loses everything -- no refund, no earnings.

**Staying King:**
- The King must call `KOTH_heartbeat()` every **50 blocks** (~10 minutes).
  Miss your heartbeat and you're vulnerable.
- The King earns **1 BUZZ every 72 blocks** (~100 BUZZ/day). Call
  `KOTH_claim_earnings()` to collect -- but you can only claim **once every
  ~3 hours** (900 blocks). No cashing out right before a rebellion.
- After a **failed rebellion** (one that expires), the king can claim immediately.
- **Late heartbeats** (in the last 10 blocks of your window) are recorded.
  They reduce the quorum rebels need. Stay on time.

**The Rebellion:**
- Any non-king player can join by calling `KOTH_rebel_join()`. Everyone pays
  the same flat stake: **20 BUZZ**.
- Rebels must also heartbeat every **30 blocks** (`KOTH_rebel_heartbeat()`).
  Miss it and you go inactive. Inactive rebels don't count toward quorum.
- **Rebellions have a time limit** -- currently **~3 hours** (900 blocks).
  If the rebellion doesn't execute the bounty in time, it expires and all
  stakes are refunded. The king stays.

**Executing the Bounty:**
- When enough active rebels meet quorum, any active rebel can call
  `KOTH_execute_bounty()` to dethrone the King.
- Required quorum: **3 + (days_king_held * growth_rate) - late_heartbeats + dead_rebels**
  - Quorum grows by **1 per day** the king holds the throne (adjustable).
- All the King's unclaimed earnings are split among **active** rebels.
- A **random active rebel** becomes the new King (their stake becomes their
  coup cost; other active rebels get refunded).
- Dead rebels forfeit their stakes.

**Mole Sabotage:**
- A player can join the rebellion with no intention of staying active. If they
  stop heartbeating, they become a **dead rebel**, which **increases** the
  quorum requirement. This protects the King.
- The King can also `KOTH_shield(address rebel)` for 10 BUZZ -- this resets
  that rebel's heartbeat timer (protecting their mole). But shields are
  **public on-chain**. Everyone can see who the King is protecting.

**Purging Moles:**
- Rebels can call `KOTH_rebel_purge(address target)` for **10 BUZZ** to
  initiate a purge against a suspected mole.
- The target has **10 blocks** to call `KOTH_rebel_heartbeat()` to survive.
- If they don't respond, call `KOTH_rebel_execute_purge(address target)` to
  remove them and reclaim quorum.
- Purge cost is **burned** -- you don't get it back even if the purge succeeds.

**Rebellion Expiry:**
- If the rebellion timer runs out (3 hours default), anyone can call
  `KOTH_expire_rebellion()` to disband it. **All rebel stakes are forfeited**
  -- they stay in the contract. The king survives and can claim earnings
  immediately. Rebelling is risky -- move fast or lose everything.

**Solo Bounty:**
- If the King's heartbeat expires and **200 blocks** pass with no heartbeat,
  anyone can call `KOTH_solo_bounty()` to claim **20 BUZZ** and dethrone the
  King. No rebellion needed -- the King simply abandoned the throne.

### KOTH Strategy Tips

- **Kings** should heartbeat on time (early, not late), recruit moles to inflate
  quorum, and shield them carefully. Claim earnings every 3 hours.
- **Rebels** should coordinate off-chain, purge suspected moles, and execute
  the bounty before the 3-hour rebellion timer expires.
- **Moles** should join the rebellion, heartbeat a few times to look legit,
  then go silent. But beware -- purges cost the rebels BUZZ to initiate.
- **Everyone** should watch the chain. Shields reveal alliances. Heartbeat
  timing reveals who is active. This is a social game as much as a technical one.
- **The random king selection** means even a small rebel can become king. You
  don't need the biggest stake -- just be active when the bounty executes.

---

## Arbitrage Pits

```
    $$$$$$$  $$$$$$$$  $$   $$
    $$    $$ $$         $$ $$
    $$    $$ $$$$$$      $$$
    $$    $$ $$         $$ $$
    $$$$$$$  $$$$$$$$  $$   $$
```

We've deployed a second token: **BullCoin (BULL)**. Two decentralized exchanges
(AMMs) trade the same pair: **BUZZ/BULL**.

| Pool       | What it is                        |
|------------|-----------------------------------|
| BuzzSwap   | SimpleDEX #1 -- BUZZ/BULL pool    |
| BullMarket | SimpleDEX #2 -- BUZZ/BULL pool    |

Both pools use the **constant product formula** (x * y = k). When someone buys
BUZZ on one pool, the price of BUZZ goes up there. The other pool's price stays
the same. If the prices diverge, there's an **arbitrage opportunity**.

### How to Arbitrage

1. Check the price of BUZZ on both pools (`priceAinB()` on each)
2. If BUZZ is cheaper on BuzzSwap, buy BUZZ there (swap BULL -> BUZZ) and sell
   it on BullMarket (swap BUZZ -> BULL). Pocket the difference.
3. If BUZZ is cheaper on BullMarket, do the reverse.

**Useful view functions:**
- `priceAinB()` -- how much BULL you get per BUZZ
- `priceBinA()` -- how much BUZZ you get per BULL
- `previewSwapAforB(amount)` -- simulate a swap before committing
- `previewSwapBforA(amount)` -- simulate the reverse
- `reserveA()`, `reserveB()` -- current pool reserves

**Swap functions:**
- `swapAforB(uint256 amountAIn)` -- send BUZZ, receive BULL
- `swapBforA(uint256 amountBIn)` -- send BULL, receive BUZZ

Remember to `approve()` the DEX to spend your tokens before swapping!

### Where Do Price Differences Come From?

The **oracle** (that's us, the instructors) periodically injects or drains
tokens from one pool to shift its price. This creates arbitrage opportunities
every few hours. The first person to spot and trade the gap profits the most.
**Speed matters.** You can write a bot, watch the chain manually, or set up
alerts -- your call.

### PnL Tracking

Both pools track your **profit and loss** on-chain:
- `getTraderPnl(address)` -- your net BUZZ and BULL flows on that pool
- `getLeaderboard()` -- all traders and their PnL

### Arbitrage Tips

- **Slippage kills large trades.** A small trade with good prices beats a huge
  trade that moves the price against you. Calculate the optimal trade size.
- **First mover advantage.** After an oracle shift, the first arb trade gets
  the best price. The second gets less. The third gets crumbs.
- **You can automate this.** Write a script that monitors both pools and
  executes when the gap is wide enough. Bots are encouraged.
- **You start with BUZZ only.** You'll need to make an initial swap to get some
  BULL before you can arb in both directions.

---

## Easter Eggs

There are easter eggs hidden in the deployed contracts. They don't require
playing any game -- just understanding how the EVM works. First to find each
egg gets bonus BUZZ.

First finder gets 30 BUZZ. Second gets 15. Third gets 5. Send
private Piazza post to claim your reward.

---

## Grading

To receive full credit you must:

1. Call at least **50 transactions** across all contracts
2. Play each carnival game (Guess, Duel, Highroller, Mine, Mayor, Exploit) **at least once**
3. Make at least **one arbitrage trade** (swap on both DEXes)
4. Attempt **King of the Hill** at least once (coup, rebel, heartbeat -- any action counts)
5. Submit a **writeup** describing:
   - How to play each game and any bugs you found/exploited
   - Any code/scripts you wrote (bots, attackers, etc.)
   - Your strategy for KOTH and arbitrage
   - Describe the optimal strategy for each game
6. **List of all your transaction hashes** (you can get these via Etherscan, cast, or web3)

All the above in a zip file and upload it on Canvas.

### Bonus Points

At the end of the assignment, the **top 3 BUZZ holders** receive grade bonuses:

| Place | Bonus                                |
|-------|--------------------------------------|
| 1st   | +10 points (full letter grade bonus) |
| 2nd   | +5 points                            |
| 3rd   | +3 points                            |

Additional bonuses may be awarded for:
- Finding easter eggs (first come, first served)
- Particularly creative exploits or bots
- Impressive KOTH political plays

---

## Rules

For this assignment, there is no such thing as cheating. The only things which
are off limits:

- **No denial of service.** Do not attack the node, the contracts' availability,
  or other students' ability to play.
- **No stealing from other students.** Exploit the contracts, not each other's
  wallets.
- **Unlimited money glitches:** if you find one, report it beforehand. Bonus
  BUZZ for responsible disclosure, instead of leaving no tokens for other students.

Everything else is fair game. Collude. Betray. Automate. Read storage. Reverse
engineer. Front-run. Bribe. If the EVM allows it, it's allowed.

If you know anything about game theory, the optimal strategy may not be to
compete with your peers, but to conspire.

---

Have fun. Make money. Trust no one.
