# Board Game Design Principles

A working reference for sessions that help design board games. It is a rewrite and condensation of the game-design articles at https://daniel.games/ by Daniel Piechnick (designer of *Radlands*, former Magic: the Gathering developer). Publishing, career, motivation, Kickstarter and playtester-recruitment material has been left out. Only principles about what makes a game good, plus a short section on design method, remain.

These are one experienced designer's strong opinions, not laws. Use them as defaults and as a checklist when you critique. When a rule here conflicts with what this particular game needs, say so openly rather than applying the rule blindly. (See "Notes for wargame work" at the end.)

---

## 0. Quick review checklist

Run a proposed mechanic, card or rule change through these questions:

1. **Core:** Does it serve the game's central activity, or is it a side system?
2. **Depth:Complexity:** Does it add more gameplay than the rules, text and attention it costs? Could a version half as complex keep 90% of the value?
3. **Rules vs. components:** Could a component (card, space, number) fix this instead of a new rule?
4. **Turn:** Does it add a step, phase, maintenance task or small choice to every turn?
5. **Choices:** Does it take options away from a player, or say "can't"? Is it a restriction where an incentive would do?
6. **Evaluable:** Can the player actually judge this choice, or is it a lucky dip or a general bonus?
7. **Context:** Is it sometimes good and sometimes bad, or is it always or never taken?
8. **Feel:** Will anyone feel bad because of it (losing progress, random penalties, being singled out)?
9. **Interaction:** Does it raise or lower how much players' decisions affect each other?
10. **Progress:** Does each action move the game noticeably forward? Does it help the game end on time?
11. **Human nature:** Will players forget it, misread it, or expect it to work differently?
12. **Clarity:** Is it one sentence or less, in plain words, ideally shown with an icon or number?

---

## 1. The core and scope

- **The core is the game.** The core is the central mechanic or mechanics. If the core isn't fun, nothing else matters. Don't work on other parts while the core is broken.
- **Make the game about one thing.** Remove everything that doesn't support or strengthen the core. A game with one great activity is great. A game with ten activities needs all ten to be great.
- **Clarity:** The more the game is about its central challenge, the easier it is to understand and to start making plans.
- **All or nothing:** Every concept should either matter a lot or be absent. If an odd one-off element is good, make more of it. If it isn't worth multiplying, cut it.
- **Decide what the game is *not* about.** Some genre-standard features should be left out, simplified or merged, to make room for what you strengthen. Complexity should sit *somewhere*, not everywhere. If one subsystem is deep, the others must be simple.
- **Build inside one or two systems.** Pick a simple framework (for example "resources plus a map", "abilities on cards in play") and express all content inside it. Avoid small add-on systems (a few "stun" counters, for instance): either make them a main system or drop them. Content that shares one system naturally combos with itself.
- **Zoom.** You can zoom in (make one small part of a genre the whole game) or zoom out (abstract a genre's usual details) to make something different.
- **Let the game drift.** Your original vision is a constraint. Follow what turns out to be fun, even if the game becomes something you didn't plan. Early constraints (fixed card count, "no rules") are useful exercises but should be dropped when they start to choke the game.
- **New combinations beat new mechanics.** Most good games recombine existing mechanics in a new way. An established genre with a big twist, done very well, beats a wholly novel idea.
- **A knockoff has to break the source's core.** A twist on a famous game that keeps its core systems intact (mana, combat stats, tapping) loses to the original. Take it apart and rebuild it with different fundamentals.

## 2. Depth:Complexity ratio and simplification

Treat this as the most important principle.

- **Depth** is how strategic and interesting the game is. **Complexity** is rules, text, numbers, icons, exceptions and procedures. Optimise the *ratio*, not depth alone.
- **Spend complexity like money.** Cut parts that are complex but add little, even if they add *something*. You can spend that budget elsewhere or simply bank it.
- **Depth should come from many simple parts interacting,** not from a few complicated parts.
- **Assume the game is about three times too complex.** Prototypes nearly always are.
- **Start with the simplest version of everything.** If it doesn't work, try the second simplest. To add to the game, add more simple things rather than making existing things more complex.
- **Things that work in similar ways should work the same way.** Where most things follow one pattern, make that the only pattern. Keep the few important exceptions as text on the components, not as rules.
- **Drop categories** wherever you can. If two categories are needed, the bigger one is the default and goes unmarked.
- **Never add a rule to fix a problem.** Fix it with components inside the existing rules: a card that wipes the board instead of an anti-snowball rule, or a card ability instead of a hand limit. Build the game so the edge case can't happen.
- **When a rule earns its place:** only when lots of content keeps doing the same thing. Then promote it to a keyword, icon or rule, so more of it costs nothing extra. The game calls for the rule.
- **When to demote a rule:** if a rule is interesting but rarely used, turn it back into one card or ability.
- **The complexity bar rises over development.** Late in design, every element must justify its gameplay per unit of complexity. Go through everything asking "can I remove this text, icon or concept?"
- **One-sentence test:** if it takes more than one sentence, it's probably too complicated.
- **Elegance:** a finished game should look so simple that people assume it's light.
- **Weight:** of two otherwise identical games, the lighter one is better. Medium-light is the sweet spot for depth, replayability and audience. Heavier needs strong justification. Very light games are a search for a hit, not something you can fix up.
- **Design space:** make it just big enough for a great game. Don't create categories or concepts in advance.

## 3. Turn structure

- **A turn is one meaningful action,** not a list of steps. Avoid phases unless they are truly needed. Simplify other parts of the game to protect a simple turn.
- **Downtime is the usual cause of boredom.** Shorter turns mean less waiting. Doing half as much per turn is fine if you wait half as long.
- **Steps are bad; steps with choices in them are worse.** Players deliberate over even trivial choices. Put choices in one place in the turn and make the rest automatic. Cut small decisions (for example, take two cards and then refill, rather than refilling between picks).
- **Use a giant menu.** If a turn has several actions, put them all in one list ("do A or B or C", or "pick any two") rather than fixed move/fight/camp steps. The structure becomes "draw, then choose from the menu."
- **Kill maintenance.** Move upkeep from the turn to the round, then from the round into actions (for example, "pay 2 to refresh the market"), or remove it. Rounds often exist only for housekeeping.
- **Parallelise:** let everyone do scoring and upkeep at once, and let actions benefit all players where that fits.
- **Optional actions players rarely take** still cost thinking time and blur when a turn ends.
- **Rest turns** (refill hand, regain energy) can replace "gain X every turn" in lighter games.
- **Prefer player control to game-run systems.** Avoid automata, neutral AI enemies and event decks where you can. Let a player steer the "bad guy" briefly instead.
- **Multi-action turns** make a game tactical and combo-driven. Two actions is usually too few for interesting combos. Three or more need a physical tracker. Avoid splitting turns into movement plus actions unless you must.
- **First-player advantage:** often fine to leave alone, especially when turns are many and small. If you mitigate it, do it invisibly in components, or with the basic resource in rising amounts by seat (calibrated to the middle player count), or with a smaller first turn. Avoid lasting fixes like "play until everyone has had equal turns." A starting-player marker that rotates is fine. Avoid fully variable turn order unless the game is about it.

## 4. Choices and agency

- **Gameplay is choices.** Be generous with options and stingy with the resources that pay for them. Ten options of which you can afford one is still a good choice.
- **Ten-options sanity check:** a player should have about ten different things they could do on a turn.
- **Access:** how much of the visible game (board, cards, market) can I affect this turn? High access gives a feeling of control; low access feels powerless. Allowing movement of 2 rather than 1, for example, opens up far more options.
- **Don't take choices away.** When a player is attacked or unlucky, they should lose points or health, not their means of acting. Don't let the number of choices depend on game state. Don't reward self-imposed choice loss.
- **Avoid "can't".** Prohibitions are fun for the designer and miserable for players. "Can't" on a *bonus* ability is fine ("gain a potion; you can't drink it this turn").
- **Incentivise, don't restrict.** Reward the behaviour you want (a bonus for matching terrain) instead of forbidding the alternative. Player powers should be positive, not penalties or neutral rule changes.
- **One restriction per action.** If it has a cost, the cost should be the only thing that stops you. Cost plus location plus timing turns the game into whether you can act at all, not what you choose to do.
- **Don't force actions** where there used to be a choice. Any forced effect goes on top of the normal choice.
- **Always-available fallback actions:** a few weak actions that are always open, so no turn is wasted and the game can always move forward.
- **Choices must be evaluable. Avoid "general benefit":**
  - *Lucky dips:* random or hidden rewards can't be planned around.
  - *General strengthening:* "+1 card per turn", "+1 action", "more income" make you better at everything, so there's no new strategy and the trailing player feels doomed. Make bonuses strong in one specific way.
  - *Too-distant future benefit* blurs into a general bonus. Near-future benefit is good because it links turns.
  - *Incidental benefit:* a bonus you get without choosing it doesn't shape any decision. Make it big enough to matter or cut it.
  - *Distinct options:* give each space or card one clear purpose, strongly ("get 3 attack cards"), not a mixed bag. One "variety pack" option is fine.
- **Context:** every card or action should be better or worse depending on the situation, and need re-evaluating each time. Nothing should be always or never taken. Cut choices that reduce to a trivial formula ("is the game nearly over?", "am I winning?").
- **Timing is depth for free.** If something can be done now or later, both should be viable. Nothing should be "always play immediately."

## 5. Player interaction

- **More interaction is better, other things equal.** A game should be either a very interesting puzzle or a fierce competition.
- **Solitaire-leaning games need a cut-throat shared area** (a scarce action board or a central market) built into the core from the start, not added later.
- **Move the objective towards the other players.** Ideally the other players *are* the objective (stealing their cargo rather than collecting free treasure).
- **Resource competition is the minimum acceptable interaction.** Keep options as few as allows a reasonable choice, so players want the same things. Make players pick through the leftovers.
- **Interaction must be readable.** Players should understand how their choices affect others. "Resource-pool solitaire," where a shared pool affects others only by accident, isn't enough.
- **Safe zones:** even aggressive games need somewhere a player can plan undisturbed (for example, an untouchable hand). Confine conflict to part of the game.
- **Politics: all or none.** Small political elements in a non-political game are bad. "Take that" games are weak.
  - Give targeting a reason (attack only those nearby, or attacks hit everyone).
  - Make attacking pay the attacker (theft, a bonus), not just hurt the target.
  - Very adversarial games are often best as two-player only.

## 6. Planning horizon and linking turns

- **The planning horizon:** let players plan ahead, but not with certainty. A fully certain plan means waiting out your next turn. "Wanting to skip ahead" is the warning sign.
- **Intuition over calculation.** Calculation is about not making mistakes; intuition is more fun and quicker. Limit perfect information (hidden hands) and drip-feed new information (draw each turn) to keep plans fluid. Don't go so far that the game is chaos.
- **Something should change between your turns:** opponents' actions, a draw, a refreshed market. A location that only gives fixed bonuses adds no new information.
- **Link turns into a larger plan:** multi-step setups, delayed effects (events that resolve later, units that can't act the turn they arrive), permanent benefits, saving up for expensive things.
- **Requirements beat costs** for long-term planning (see §7).
- **Interlinking is the key to strategy.** A self-contained system ("roll vs. defence") is solvable and dull. Tie its outcome to another system: combat that costs cards, or attackers that go back to base on the map. The other system must be complex enough that the trade-off can't be solved. If you can't interlink, you're short of systems or depth.
- **Two very different interlinked systems** (spatial plus non-spatial market, for example) make a classic unsolvable core. Human systems (bluffing, negotiation, dexterity) are very deep things to link to.
- **Goals give direction and tension.** Aimlessness, where players can do anything but nothing pushes them, is a common hidden cause of "mysteriously not good." Start players with at least one goal. Make goals worth a lot. Prefer threshold goals ("3 houses = 7 pts") to per-unit scoring ("2 per house"). Goals should *require* things rather than *consume* them. Completing goals during the game, with repeating rewards, beats checking only at the end.

## 7. Progression, pace and excitement

- **Growth feels good.** Players should start weak and become powerful: a journey from poverty, through struggle, to power, and then the game ends.
  - Start with nothing, or less than nothing (debts, obstacles), but with plenty of options.
  - Struggle is the fun part. Keep players in the "painful trade-off" phase. Once they've overcome the game, end it within a turn or two.
  - **Ramps:** the game should build up from tiny actions to almost game-breaking ones. Give several systems their own ramps so the winner isn't obvious. At least one important thing should only ever go up. Snowballing is part of the fun.
  - **Permanent gains** (income, discounts, unlocks) beat one-off rewards. Cyclical resources are fine if spent on something permanent.
  - **Costs are cyclical and feel bad; requirements are growth and feel good.** Use more requirements.
  - Attacking is usually cyclical (you hit them and gain nothing). Watch for this in fighting games.
  - **Component test:** where do the pieces end up? They should pile up in front of players, not cycle back.
- **Pace:** every action should move a player a significant way through some system. If two turns in a row are the same chore, compress them (for example, make converters far stronger). Many low-health targets beat one high-health target. Speed up or slow down so most of the game is spent in its best phase.
- **Supercharge:** try halving all costs. Get through the content quickly. Shorter, punchier games are a bonus.
- **Big moves:** small incremental turns are predictable. Punctuate them with big turns, and make the *option* of a big move available on most turns.
  - Variable actions: pay more, get more; "for each", "all", "double", "triple".
  - Combine dull actions so they can be built up into one big move.
  - Let combos and setups pay off spectacularly. Don't stop the madness, just make sure it's fair and can't be looped easily.
- **Awesome things:** most content should be plain, but include a few rule-breaking, too-good-to-be-true items that make people go "WHAT?!" They should *feel* outrageous while being reasonably costed. Memorable stories make great games.
- **Tension** needs a risk of loss or (better) of missing out. Aim for moderate tension, where failing forces a change of plan rather than doom.
  - Time pressure: short timers and checkpoints. End-of-round goals beat end-of-game goals.
  - Vulnerability: in adversarial games, make players fragile. Being close to death is exciting.
  - All or nothing: avoid half reward for half achievement. One-time opportunities that are gone once taken. Jackpots that grow until someone grabs them.

## 8. Length, ending and winning

- **As short as possible.** A good game ends one turn too soon. Assume yours is too long. Cut until playtesters start debating whether it's too short. Fewer rounds, then one fewer. Cut weaker stages entirely. Match length to weight: about 20–30 minutes for medium-light.
- **Ramp games should be just long enough** to reach some of the biggest things. If someone can complete every path, it's too long.
- **Make sure it ends.** Length shouldn't swing far above typical.
  - Soft ratchets (life totals, captured pieces) push towards the end but don't guarantee it.
  - Add a **hard ratchet** as a backup (fixed rounds, a running-out supply, a points threshold). Points as a backup win condition, used maybe a third of the time, works well.
  - Keep healing and repair to a minimum. They work against progress.
- **Victory:** if there's no natural thematic end, use points for "doing good stuff." Give themed points a theme name. Keep scoring simple. Don't add end-game penalties for things that are already bad.
- **Avoid player elimination,** especially early. Exception: games built on cliffhangers, where each cliffhanger is *probably* survived and elimination comes late, possibly several players at once.
- **Ties are fine.** If there's a tiebreaker, use the player who would lead if the game ran a bit longer (follow the victory chain backwards). Never a random tiebreaker, never one based on turn count, and never a second tiebreaker.
- **No anticlimactic certain wins.** The final blow should depend on hidden information (a card from hand), so nobody is visibly doomed until the end.
- **Catch-up mechanics:** an unwinnable position is miserable, but obvious score-based catch-up (handouts for whoever is behind) is unfair and feels bad. Prefer:
  - Built-in catch-up: big moves, end-weighted ramps (double points late), effects proportional to holdings ("everyone loses half").
  - Hidden scoring that obscures the leader through secret objectives, not through hard-to-remember face-down points.
  - Ending the game sooner, before a lead becomes certain.
  - A trailing player only needs about a 5% chance for the game to stay engaging.
  - Losses should cost points or health, not the means to fight back.

## 9. Balance

- **Fun and elegance come before balance.** Balance is easy to fix later by changing numbers, so design the cool, clean version first.
- **Good enough:** each option only needs to be worth considering. A hand of individually unbalanced cards still evens out.
- **Balance with numbers, not rules or text.** Put a tunable number (cost, points, starting cards) on everything.
- **Balance by play, not spreadsheets.** Guess, play, adjust. Data-mining playtests is wasted effort, because the next change invalidates it.
- **Balancing heuristics:**
  - An action spent is a cost. A twice-as-big action for twice the price is *better*, because it uses one turn. Free cards still cost a card.
  - Expensive, slow things should be outrageously strong. Things are usually weaker than you think, so don't hesitate to triple something.
  - Watch for overkill (does the twentieth axe matter?).
  - Power depends heavily on context.
  - For rough comparison, convert everything into the game's basic currency.
- **Intentional imbalance:** make things the game *needs* (progress, refresh) slightly too good, so players do them without a rule. Unequal draws (Scrabble blanks) can be exciting in lighter games.
- **Balance the fun, not just the power.** If the "survive" option is boring and "get money" is exciting, players neglect survival. Pair boring necessities with something interesting, or don't make cool abilities compete with dull upkeep (give them a separate resource). Spend-everything-on-one-thing turns are dull. Prefer splits.

## 10. Randomness and uncertainty

- **Uncertainty is necessary;** otherwise the game gets solved. Good sources are interlinking, hidden information and player interaction. Plain randomness is the lazy source: it often feels bad, disrupts, and rewards luck over skill.
- **Resolve conflicts with hidden information rather than dice** where you can (the defender may play a shield card).
- **One source of uncertainty is enough.** Don't add a combat roll to an already random draw.
- **Input randomness** (random draw, then free use) supports strategy. **Output randomness** (decide, then roll for the result) doesn't, so save it for light, excitement-driven games built around it.
- **Some randomness is good:** variety between games, underdog chances, excitement. Ignore testers who want it all removed.
- **When output randomness stays,** make outcomes *different*, not *good vs. bad* (failure still teaches you something, or refunds you). Never let one outcome be strictly worse on every axis. Give the weak one some upside, or make it the common one so the strong one is a pleasant surprise.
- **Randomise rewards, not penalties.**
- **Dice:** avoid "result = magnitude" (move as far as you roll). Use faces as types or matches. Custom dice: one pair of repeated faces for structure, the rest different, no blanks.

## 11. Resources and economies

- **How many resources depends on what the game is about:**
  - *Not about resources:* use one universal currency that only limits activity. This maximises choice.
  - *Significantly about resources:* each resource needs its own identity and subsystem. No two should be equivalent (a "block" stat is just health). No lucky-dip resource that is really a random route to the others. Ideally each has two sources and two uses.
  - *Fundamentally about conversion:* resources can be many and need no identity.
- **Pick the simplest, most obvious resources** (wood, stone, gold, food, health, money). Don't worry about realism. Prefer resources with several thematic uses (spear: fighting and fishing). Plain colour names ("red gem") are fine for abstract cubes.
- **Build a web, not a chain.** Each resource should have several unrelated uses and several sources. Connect distant parts of the web. Two or three ways to do each thing, not ten.
- **Stop tight loops.** If players can repeat A→B→points forever, lengthen the loop (pay with a distant resource), add by-products that pull players elsewhere, and make points non-repeatable (goals and buildings that score conditionally, not a "gain points" space).
- **Action quantities:** give 1 of a thing unless there's a reason to give more. Conversion actions should be unlimited or repeatable, because they are big moves. Bundle dull actions that share a cost so each unit becomes a choice ("sow and/or bake").
- **Every path should be a viable way to win.** All end-point resources score, and everything else can convert into them. Cap runaway engines with overflow into points.

## 12. Spatial systems

- **Spatial systems have a huge Depth:Complexity ratio** (adjacency is intuitive and rich), but carry hidden costs: boards, pieces, range rules, information overload, slow thinky turns.
- **Ask whether the game works without a map.** If it does have space, the game must be *about* where things are. Otherwise placement shouldn't matter.
- **Simpler shapes first:** a 1D line or loop is still a real system.
- **Placement** (pieces placed, never moved) gives full access with no movement rules. It's the safest 2D choice.
- **Multiple movable units** (chess, wargames) bring very high component and complexity cost, long, calculation-heavy games, and range rules. If range is needed, cap it at about 2 spaces. Mitigate by moving few pieces per turn, using small boards and few units.
- **A single movable unit** (travel games) is full of problems: why move at all, and journeys are boring. Interesting things must happen *during* the journey, each area must serve a different purpose, and interaction is hard. Usually better: a board where you can go anywhere, with no movement.

## 13. Cards, decks and hands

- **One card or action does one thing.** Make two cards instead of a two-effect card; each can combo separately.
- **Think inside the box.** Weird effects that reach outside the game's normal rules or components make it worse, not better.
- **Conditional effects** give rich design space, but the player must control the condition. If the game controls it, it's just randomness. If the opponent controls it, it won't happen. Self-synergy: give the card a second ability that helps create its own condition.
- **Rule-changers** (cards that make part of the game work differently) are the best category. Go through each rule and make a card that breaks it.
- **Downsides** add strategy and can double as a way to clear out the game state.
- **Ongoing-effect cards should also be worth points,** so they are useful both early and late.
- **Deck composition:** a deck has a job; it isn't a pile of your coolest ideas.
  - Most cards are very simple (an icon, or one sentence) and straightforward (basic resources and actions). The hand is interesting as a whole. Expect 90% simple by the end.
  - Use 3–5 copies of the core cards and 1–2 of each exotic one. Keep decks small if cards aren't the core. Halving a deck and keeping the best half often improves it.
  - Repeated common cards make the opponent's hand predictable enough to play around. Fully unique decks suit discovery games, not strategy games.
  - Avoid deck construction before play.
- **Hands:** a hand gives choice, links turns and adds hidden information. Most games benefit from a deck with a draw each turn. A 5–7 card hand is often too small for real choice: give lots of cards plus ways to use unwanted ones (discard as payment, spend for a small effect). Avoid "choose and discard" steps (slow, low-stakes) and hand limits.

## 14. Theme

- **Pick a theme people instantly find interesting,** and prefer things they already know and love but haven't seen as a board game (ant colony, kids on skateboards). Avoid generic fantasy, generic sci-fi and anthropomorphic animals. Evoke a specific known flavour instead. Invented lore mostly fails to come across: players only see art, names and the title.
- **The theme must match what players actually do.** Choose rules that create the feeling (pirate: roam and raid at will; spy: secret plans and secret information). No amount of art fixes a mismatch.
- **Size the theme to the game.** Use the smallest theme that fits, and don't put an epic story on a small game.
- **Keep the theme broad early.** Let card and resource choices narrow it down as theme and mechanics develop together.
- **Relatability:** objects should evoke known things *and behave like them* (a wounded soldier you must heal before using). This also makes rules memorable.
- **Soak everything in the theme:** every name, resource and icon. Ask what the best-known element of the theme fits each mechanic (the cubes you deliver become map pieces to buried treasure).
- **Entities first:** most content should be people, then places, then objects. Abstract events, spells and states are hard to tell apart and to illustrate.
- **Names:** use real or well-known things ("Sniper", "Blood Bank"). Two-word names should be known phrases, not adjective-noun soup. Proper names should be short, easy to pronounce and clearly distinct from each other. Purely mechanical items (resource goal cards) may need no name.
- **Flavour text** only for strongly theme-driven or historical games, or for humour.
- **Mechanics beat theme.** Bend the theme to fit mechanics you need. Don't strain to justify everything. Humour counts as theme and is welcome. The best humour comes from interactions, not from jokey card names.

## 15. Information, components and presentation

- **Watch for information overload.** Players shouldn't have to read dozens of cards and spaces to know what's going on. A busy-looking game puts people off before they start. Information that builds up over time is more acceptable than lots shown at the start.
- **The more on display, the simpler each item must be.** Keep fixed elements the same every game, colour-code by function, and limit each item (for example, at most 2 icons and 1 line of text). Group related information and arrange it in regular grids. Get everything that isn't a basic supply onto one board, and give each player's things a spot on their own board.
- **Tangible beats abstract:** represent game state with pieces that are in play, out of play or in a place, rather than text and tracked numbers. Add complexity as more objects, not more intricate objects. Avoid subtypes and factions that have no behaviour of their own.
- **Icons:** about half of what the game communicates should be icons and numbers. Turn any repeated text into an icon, then use it more widely. Keep icons very simple, flat and on a coloured background shape, each in a distinct colour. One object per icon, no arrows. Don't go as far as hieroglyphics. Use keywords only for concepts that appear inside sentences. Modify standard icons with short text ("⚔ any card") rather than writing the effect out each time.
- **Terminology:** use plain words. No jargon for ordinary things (a deck is a deck). Name new concepts with whatever word most people would guess. Neutral terms (location, character, board) are best. Avoid Magic/D&D jargon (target, resolve, control, active player, orthogonal, 3d6) and classic card-game words (joker, wild, run). Don't name every zone.
- **Wording:** convey the meaning to the most people. Conversational, even redundant or slightly imprecise, is fine. Use an example for fiddly procedures. Explanatory reminders go in small grey brackets. Write for reasonable players, not rules lawyers. If anyone misunderstands, it's your problem.
- **Aesthetic patterns:** give costs and numbers order (cycles like AABB, BBCC; matched numbers like 3 and 3). Order reads as a meaningful system, sets up expectations and is easier to remember. Then let a few things break the pattern; rule-breaking is fun. A regular grid map makes cutting across it feel transgressive.
- **Human nature wins.** If players keep doing something "wrong," change the rule to match what they do. Remove procedures people forget. If several players feel something is weird, it is. Ask testers how they expect things to work. People expect to draw at the start of a turn, to move first, and to use the space they arrive at.
- **"It has to be that way" is never acceptable.** Players don't care why a clunky rule exists. Fix it, or accept the game isn't finished. **"I just want":** list the outcomes you want, ignoring the knock-on problems, then solve the one hard problem that results.
- **Prototype graphics:** neat and plain (flat colour blocks, art, readable fonts). Large text (about 20–30 characters per line) with a text hierarchy, colour used for meaning, never text-only cards. No bevels, gradients, shadows or textures.
- **Rulebook structure** (when the time comes): components → story → overview → objective → setup (numbered diagram) → master statement ("players take turns clockwise") → turn steps referring to sub-sections → extra rules → game end → "start playing now" → icon reference card → a first-turn strategy tip → an alphabetical card FAQ plus a General section. Repeat rules where needed instead of nesting definitions. A one-page quick-rules sheet is valuable. Don't maintain a rulebook during development; use a reminder card.

## 16. Replayability and player count

- **Replayability comes from how different each game is.** Add variation only if the game clearly lacks it. An 8/10 game you play ten times beats a 7/10 game you play a hundred times.
- **Vary the setup, not the rules or objective.** A few cards that bend rules (dealt or drafted at the start) are best.
- **Variable player powers** add only as many variations as there are powers. Fewer than about 20 setups feels worse than none. Several variable factors that interact (each player's power against each other's) multiply variety.
- **Keep one main source of variation,** so it still feels like the same game.
- **Avoid true asymmetry** (completely different rules per side). It costs far more than it returns.
- **Nudge players** into new strategies with a starting mini-objective, so they don't pick a path arbitrarily.
- **Without enough variety, players solve the opening.**
- **Player count:** 2–4 is the norm. Tune for 3 so 2 and 4 are close. 5 is possible with short turns, high interaction and few personal components. 6 must be designed for from the start. Very adversarial games are best as two-player only. Don't shoehorn in extra counts with special modes. Design and test at 2 first.
- **Scaling:** the best scaling is none. Change as little as possible. With more players, use fewer rounds or the same fixed supply, so length doesn't balloon. Don't make players sort cards by player count. A double-sided board for 2–3 and 4+ is fine.
- **First play matters most.** Most people play a given copy once. Offer a beginner setup with the plainest elements and no pre-game choices, or a cut-down family version for heavy games.

## 17. Feelbad patterns to avoid

- Losing built-up progress (equipment, engine, land) rather than points or temporary resources.
- Penalties to the losing side where gains to the winning side would do the same job. Gains feel far better.
- Score-based handouts or punishments for the leader.
- Random penalties, and outcomes that are strictly worse on every axis.
- Arbitrary targeting in multiplayer ("I'll hit… YOU").
- Destroying resources or cards that pay for choices (land destruction, hand discard).
- "Can't", restrictions, and penalty-style player powers.
- Being eliminated early, or being visibly doomed long before the end.
- Opponents meeting conditions that only they control.
- It doesn't matter that the player chose it or that it is technically fair. If it feels bad, change it.

---

## 18. Design method (how to work, for sessions helping iterate)

- **Design is iterative experiment, not craft.** Change, rebuild components, playtest, repeat. Expect about 50 revisions for a light game, 100–150 for medium-light and about 200 for medium. Speed up the loop.
- **Start-up questions:** what does each player have? What is the interaction? What are the actions? What is the turn structure? What is the objective? The answers are the game. If you want to change the structure later, you have a different game.
- **The first play should be fun even if broken.** If it isn't, abandon it.
- **Minimal first prototype:** only the first ten minutes or one round, two players, a corner of the board, tiny decks, plain "normal" actions, no variability, no art beyond telling things apart, placeholder names, a rules reminder card, a temporary win condition. Cover the full breadth of the game, but short.
- **Fix the biggest problem each revision.** Change one main thing at a time so you can tell cause from effect. Tolerate lesser flaws, because some go away on their own.
- **Keep content small.** Bench content rather than updating everything after each change.
- **New things start out overpowered and cheap,** so they get used. Tone them down later. Add the least needed to test them and handle interactions by ruling on the spot.
- **Swap a core subsystem freely if its inputs and outputs stay the same.** Adding or removing a major part is really starting a new game. Fundamental redesigns usually fail.
- **Late design narrows down.** Accept less and less change. Change things to fix problems, not to add cool things. Fix by changing components rather than rules. Very late, *remove* rather than repair. Non-structural matters of taste (names, art, length, small mechanics) can be decided by playtester majority.
- **Done means:** several plays in a row where nobody wants to change anything, testers can't find faults and ask to buy it, and then a "resting" period of just playing for a month or two, which still turns up tweaks. Polish every number and card. Fix every oddity, even ones you thought came with the genre.
- **Using feedback:** players are the experts on their own fun. Listen without defending. Mull over even "wrong" suggestions. Take the problems they report seriously, but ignore their structural solutions (finding problems is hard; solutions are your job). Ask for feelings, problems and ideas ("what was least fun?"), not balance opinions or attempts to break the game. Unprompted "let's play again" or "I'd buy this" is the real signal. Positive feedback doesn't cancel negative feedback. Watch your own emotions while playing: if you're bored or frustrated, so are they.

---

## Notes for wargame work

The source author is openly sceptical of several things wargames rely on: multiple movable units on a 2D map, range rules, player elimination, complex combat systems, asymmetric sides and long play times. Don't read this as "wargames are bad." Read it as the price list for those choices:

- If the map and unit movement *are* the core, the game must be about positioning, and other subsystems (economy, combat resolution, upkeep) should be correspondingly minimal (§1 "complexity somewhere, not everywhere").
- Pay down the cost of many units: few units moved per turn, small boards, short range (about 2), simple uniform movement, readable unit states shown by pieces rather than tracked numbers.
- Prefer hidden information (cards, orders) to piles of dice for combat uncertainty, and keep one source of uncertainty (§10).
- Make attacking a *gain* for the attacker, not just damage, to avoid purely cyclical combat (§7).
- Use a hard ratchet (fixed rounds, objective points) so games end on time (§8).
- Keep a safe zone for planning, and confine destruction so losers keep their ability to act (§4, §5).
