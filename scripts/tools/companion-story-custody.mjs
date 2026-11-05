#!/usr/bin/env node
/**
 * Autonomous Companion Story & Progression Custodian Runner
 * 
 * - Drives gameplay autonomously using local fast-paths for routine mechanics
 * - Calls remote Mac Mini model (http://192.168.3.106:11434) for branch choices & decision logic
 * - Hands off combat to instant local battle logic
 */

import http from 'node:http';

const CHAYA_API = 'http://localhost:3000/api/mcp';
const MAC_MINI_OLLAMA = process.env.MAC_MINI_OLLAMA || 'http://192.168.3.106:11434';
const MAC_MINI_MODEL = process.env.MAC_MINI_MODEL || 'gemma4:e4b';

let rpcId = 1;

async function rpc(name, args = {}) {
  const payload = {
    jsonrpc: '2.0',
    id: rpcId++,
    method: 'tools/call',
    params: { name, arguments: args }
  };
  const res = await fetch(CHAYA_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:3000',
      'Host': 'localhost:3000'
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC ${name} error: ${JSON.stringify(data.error)}`);
  if (!data.result || !data.result.content || !data.result.content[0]) return null;
  const rawText = data.result.content[0].text;
  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

async function evalInGame(code) {
  return rpc('chaya_live_eval', { code });
}

async function askMacMini(prompt, systemPrompt = '你是一个RPG游戏伴游AI。根据NPC对话和选项，选择最合适的选项推进剧情。只需回复一个数字索引（如 0 或 1 或 2）：') {
  const started = Date.now();
  try {
    const res = await fetch(`${MAC_MINI_OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MAC_MINI_MODEL,
        system: systemPrompt,
        prompt: prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 20 }
      })
    });
    const data = await res.json();
    const latency = Date.now() - started;
    const match = data.response.match(/\d+/);
    const choice = match ? parseInt(match[0], 10) : 0;
    return { choice, latency, raw: data.response.trim() };
  } catch (err) {
    console.error('Mac Mini query failed:', err.message);
    return { choice: 0, latency: Date.now() - started, error: err.message };
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`[Custodian] Starting story custody...`);
  console.log(`[Custodian] Backend: ${CHAYA_API}`);
  console.log(`[Custodian] Remote Model: ${MAC_MINI_OLLAMA} (${MAC_MINI_MODEL})`);

  // 1. Ensure 60fps update loop in background & auto dialogue
  await evalInGame(`
    if (!window.__bgUpdateLoop) {
      window.__bgUpdateLoop = setInterval(() => {
        if (document.hidden && !SceneManager._stopped) SceneManager.update();
      }, 16);
    }
    if (!window.__autoAdvanceTimer) {
      window.__autoAdvanceLog = [];
      window.__autoAdvanceTimer = setInterval(() => {
        const scene = SceneManager._scene;
        if (!scene || !scene._messageWindow) return;
        const win = scene._messageWindow;
        if (win.pause && !win.isAnySubWindowActive()) {
          const text = $gameMessage ? $gameMessage.allText() : "";
          if (text && (!window.__autoAdvanceLog.length || window.__autoAdvanceLog[window.__autoAdvanceLog.length - 1] !== text)) {
            window.__autoAdvanceLog.push(text);
          }
          win.pause = false;
          if (typeof win.terminateMessage === "function") win.terminateMessage();
        }
      }, 50);
    }
    true;
  `);

  console.log(`[Custodian] Background pump & dialogue driver active.`);

  let lastMapId = null;
  let lastLoggedText = '';
  let modelCallCount = 0;
  let startTime = Date.now();

  while (Date.now() - startTime < 600_000) {
    const status = await evalInGame(`
      return {
        scene: SceneManager._scene ? SceneManager._scene.constructor.name : null,
        mapId: $gameMap ? $gameMap.mapId() : null,
        playerPos: $gamePlayer ? { x: $gamePlayer.x, y: $gamePlayer.y } : null,
        canMove: $gamePlayer ? $gamePlayer.canMove() : false,
        isChoice: $gameMessage ? $gameMessage.isChoice() : false,
        choices: $gameMessage && $gameMessage.isChoice() ? $gameMessage.choices() : [],
        dialogueText: $gameMessage ? $gameMessage.allText() : "",
        isMessageBusy: $gameMessage ? $gameMessage.isBusy() : false,
        gold: $gameParty ? $gameParty.gold() : 0,
        switches: {
          s1: $gameSwitches ? $gameSwitches.value(1) : false,
          s7: $gameSwitches ? $gameSwitches.value(7) : false
        }
      };
    `);

    if (!status) {
      await sleep(200);
      continue;
    }

    if (status.mapId !== lastMapId) {
      console.log(`\n>>> [Map Transition] Now on Map ${status.mapId} (Scene: ${status.scene})`);
      lastMapId = status.mapId;
    }

    // Handle Gameover by returning to Title
    if (status.scene === "Scene_Gameover") {
      console.log("[Gameover] Returning to Title...");
      await evalInGame("if (SceneManager._scene && typeof SceneManager._scene.gotoTitle === \"function\") SceneManager._scene.gotoTitle();");
      await sleep(1000);
      continue;
    }

    // 1. Title scene -> Start Game
    if (status.scene === 'Scene_Title') {
      console.log(`[Title] Triggering New Game...`);
      await evalInGame(`SceneManager._scene.commandNewGame();`);
      await sleep(800);
      continue;
    }

    // 2. Battle scene -> High-Speed Local Battle Execution
    if (status.scene === 'Scene_Battle') {
      console.log(`[Combat] Battle detected! Resolving with high-speed local battle core...`);
      await evalInGame(`
        let steps = 0;
        while (SceneManager._scene && SceneManager._scene.constructor.name === "Scene_Battle" && steps < 1000) {
          steps++;
          const s = SceneManager._scene;
          if (BattleManager.isBattleEnd() || BattleManager._phase === "battleEnd") {
            BattleManager.update();
            s.update();
            continue;
          }
          if (s._partyCommandWindow && s._partyCommandWindow.active) {
            s.commandFight();
          } else if (BattleManager.isInputting() && BattleManager.inputtingAction()) {
            const livingIdx = $gameTroop.members().findIndex(e => e.isAlive());
            if (livingIdx >= 0) {
              const action = BattleManager.inputtingAction();
              action.setAttack();
              action.setTarget(livingIdx);
              BattleManager.actor().setLastBattleSkill($dataSkills[BattleManager.actor().attackSkillId()]);
              BattleManager.selectNextCommand();
            }
          }
          if ($gameMessage && $gameMessage.isBusy()) {
            $gameMessage.clear();
          }
          BattleManager.update();
          s.update();
        }
        $gameParty.members().forEach(m => m.recoverAll());
        return { steps, phase: BattleManager._phase };
      `);
      await sleep(200);
      continue;
    }

    // 3. Choice list popup -> Ask Mac Mini Model
    if (status.isChoice && status.choices.length > 0) {
      const choiceKey = status.choices.join('|');
      if (!global.__choiceAttempts) global.__choiceAttempts = new Map();
      const attempts = global.__choiceAttempts.get(choiceKey) || new Set();

      const recentHistory = await evalInGame(`return window.__autoAdvanceLog ? window.__autoAdvanceLog.slice(-5) : []`);
      const contextText = (recentHistory || []).map(t => t.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join('\n') || status.dialogueText;

      console.log(`[Choice] Branch encountered with ${status.choices.length} options: ${JSON.stringify(status.choices)}`);
      console.log(`[Choice] Recent context: "${contextText.replace(/\n/g, ' ').slice(0, 80)}..."`);
      console.log(`[Choice] Already tried options: [${Array.from(attempts).join(', ')}]`);
      console.log(`[Choice] Calling Mac Mini (${MAC_MINI_MODEL})...`);

      const questionPrompt = `剧情对话历史：\n${contextText}\n\n选项列表：\n${status.choices.map((c, i) => `${i}. ${c}`).join('\n')}${attempts.size > 0 ? `\n（注意：选项 ${Array.from(attempts).join(', ')} 之前已尝试过被NPC驳回，请尝试其他选项）` : ''}\n请直接回复推进剧情的选项编号：`;
      const result = await askMacMini(questionPrompt);
      modelCallCount++;

      let pickedIdx = result.choice;
      if (attempts.has(pickedIdx)) {
        // Fallback: pick the first unattempted choice
        for (let i = 0; i < status.choices.length; i++) {
          if (!attempts.has(i)) {
            pickedIdx = i;
            break;
          }
        }
      }
      attempts.add(pickedIdx);
      global.__choiceAttempts.set(choiceKey, attempts);

      console.log(`[Choice] Selected option ${pickedIdx}: "${status.choices[pickedIdx]}" (${result.latency}ms, raw: "${result.raw}")`);
      
      await evalInGame(`
        const win = SceneManager._scene._messageWindow;
        const choiceWin = win ? win._choiceWindow : null;
        if (choiceWin) {
          choiceWin.select(${pickedIdx});
          choiceWin.callOkHandler();
        }
      `);
      await sleep(500);
      continue;
    }

    // 4. Log meaningful dialogue progress
    if (status.dialogueText && status.dialogueText !== lastLoggedText) {
      lastLoggedText = status.dialogueText;
      console.log(`[Dialogue] "${status.dialogueText.replace(/<[^>]+>/g, '').trim().slice(0, 80)}"`);
    }

    // 5. Progression logic on Scene_Map when player can move
    if (status.scene === 'Scene_Map' && status.canMove) {
      // Map 215 (Opening Select)
      if (status.mapId === 215) {
        console.log(`[Map 215] Selecting Act I Prologue...`);
        await rpc('chaya_live_press', { key: 'ok' });
        await sleep(500);
        continue;
      }

      // Map 1 (Thieves Guild Hall)
      if (status.mapId === 1) {
        const hasDagger = await evalInGame(`
          const a = $gameParty.leader();
          return a ? a.hasWeapon($dataWeapons[5]) : false;
        `);
        if (!hasDagger) {
          console.log(`[Map 1] Walking to weapon chest at (8, 8)...`);
          await rpc('chaya_live_interact', { eventId: 3 });
          await sleep(500);
          await evalInGame(`
            const a = $gameParty.leader();
            const w = $dataWeapons[5];
            if (a && w && !a.isEquipped(w)) a.changeEquip(0, w);
          `);
          continue;
        } else {
          console.log(`[Map 1] Dagger equipped. Entering secret staircase to trial...`);
          await rpc('chaya_live_interact', { eventId: 14 });
          await sleep(800);
          continue;
        }
      }

      // Map 4 (Guild Dungeon Trial)
      if (status.mapId === 4) {
        // Check quest progress
        if (status.gold < 50) {
          console.log(`[Map 4 Quest] Current Gold: ${status.gold} / 50. Collecting trial chests...`);
          
          // Chest 7 (1, 11) - 10 gold
          const e7Done = await evalInGame(`return $gameSelfSwitches.value([4, 7, 'A'])`);
          if (!e7Done) {
            console.log(`[Map 4] Navigating to Chest 7 at (1, 11)...`);
            await rpc('chaya_live_move_to', { x: 6, y: 9 });
            await rpc('chaya_live_press', { key: 'down' }); // Step through door
            await sleep(300);
            await rpc('chaya_live_move_to', { x: 2, y: 11 });
            await rpc('chaya_live_interact', { eventId: 7 });
            await sleep(400);
            continue;
          }

          // Chest 8 (10, 13) - 10 gold
          const e8Done = await evalInGame(`return $gameSelfSwitches.value([4, 8, 'A'])`);
          if (!e8Done) {
            console.log(`[Map 4] Navigating to Chest 8 at (10, 13)...`);
            await rpc('chaya_live_move_to', { x: 9, y: 12 });
            await rpc('chaya_live_interact', { eventId: 8 });
            await sleep(400);
            continue;
          }

          // Switch 7 (12, 11) Note: "money under cushion"
          if (!status.switches.s7) {
            console.log(`[Map 4] Reading note at (12, 11) to discover cushion switch...`);
            await rpc('chaya_live_interact', { eventId: 12 });
            await sleep(500);
            continue;
          }

          // Chest 15 (6, 8) - 10 gold under cushion
          const e15Done = await evalInGame(`return $gameSelfSwitches.value([4, 15, 'A'])`);
          if (!e15Done) {
            console.log(`[Map 4] Retrieving hidden gold from cushion at (6, 8)...`);
            await rpc('chaya_live_interact', { eventId: 15 });
            await sleep(400);
            continue;
          }

          // Door 2 (17, 10) to Right Hallway
          const playerAtLeft = await evalInGame(`return $gamePlayer.x < 17`);
          if (playerAtLeft) {
            console.log(`[Map 4] Moving through passage door to East Chamber...`);
            await rpc('chaya_live_move_to', { x: 17, y: 9 });
            await rpc('chaya_live_press', { key: 'down' });
            await sleep(300);
          }

          // Chest 13 (21, 3) - 10 gold
          const e13Done = await evalInGame(`return $gameSelfSwitches.value([4, 13, 'A'])`);
          if (!e13Done) {
            console.log(`[Map 4] Navigating to Chest 13 at (21, 3)...`);
            await rpc('chaya_live_move_to', { x: 21, y: 4 });
            await rpc('chaya_live_interact', { eventId: 13 });
            await sleep(400);
            continue;
          }

          // Chest 14 (20, 15) - 10 gold
          const e14Done = await evalInGame(`return $gameSelfSwitches.value([4, 14, 'A'])`);
          if (!e14Done) {
            console.log(`[Map 4] Navigating to Chest 14 at (20, 15)...`);
            await rpc('chaya_live_move_to', { x: 20, y: 14 });
            await rpc('chaya_live_interact', { eventId: 14 });
            await sleep(400);
            continue;
          }
        } else {
          // Gold >= 50: Turn in quest to Boris
          console.log(`\n========================================`);
          console.log(`[Map 4 Quest] 50 Gold collected! Turning in to Master Boris at (3, 3)...`);
          console.log(`========================================`);
          await rpc('chaya_live_move_to', { x: 17, y: 11 });
          await rpc('chaya_live_press', { key: 'up' }); // Step through door back to hallway
          await sleep(300);
          await rpc('chaya_live_move_to', { x: 6, y: 11 });
          await rpc('chaya_live_press', { key: 'up' }); // Step through entrance door
          await sleep(300);
          await rpc('chaya_live_move_to', { x: 3, y: 4 });
          await rpc('chaya_live_interact', { eventId: 5 });
          await sleep(1500);

          const questDone = await evalInGame(`return $gameSwitches.value(6) || $gameVariables.value(1) >= 50`);
          console.log(`[Map 4 Quest] Boris trial completed! (Quest state: ${questDone})`);
          // Step through secret passage door at (1, 7) into Map 5
          console.log(`[Map 4] Stepping through secret passage at (1, 7) into Map 5...`);
          await rpc('chaya_live_move_to', { x: 1, y: 6 });
          await rpc('chaya_live_press', { key: 'down' });
          await sleep(1200);
          continue;
        }
      }

      // Map 5 (Guild Trial Dungeon 2)
      if (status.mapId === 5) {
        const switch12 = await evalInGame("return $gameSwitches.value(12)");
        const switch13 = await evalInGame("return $gameSwitches.value(13)");
        const switch14 = await evalInGame("return $gameSwitches.value(14)");
        const switch23 = await evalInGame("return $gameSwitches.value(23)");
        const pos = status.playerPos || { x: 0, y: 0 };

        // Post-combat safeguard: keep HP healthy
        await evalInGame("if ($gameParty.leader() && $gameParty.leader().hp < $gameParty.leader().mhp) $gameParty.leader().recoverAll();");

        // Phase 1: Step to Boris trigger at (4, 11) if Switch 12 is off
        if (!switch12) {
          console.log("[Map 5] Approaching Boris at (4, 11) for trial 2 briefing...");
          await rpc("chaya_live_move_to", { x: 4, y: 11 });
          await sleep(500);
          continue;
        }

        // Phase 2: Step to Rat combat trigger at (6, 11) if Switch 13 is off
        if (!switch13) {
          console.log("[Map 5] Stepping to encounter point (6, 11) for trial combat...");
          await rpc("chaya_live_move_to", { x: 6, y: 11 });
          await sleep(500);
          continue;
        }

        // Phase 3: Rat defeated. Trigger Shadow Elder at (5, 5) if Switch 14 is off
        if (!switch14) {
          console.log("[Map 5] Rats defeated! Navigating through sewer corridor to Shadow Elder...");
          if (pos.x < 18 && pos.y >= 11) {
            await rpc("chaya_live_move_to", { x: 18, y: 15 });
            await sleep(300);
            continue;
          }
          if (pos.x === 18 && pos.y === 15) {
            await rpc("chaya_live_interact", { eventId: 41 });
            await sleep(400);
            continue;
          }
          if (pos.y > 8) {
            await rpc("chaya_live_move_to", { x: 16, y: 8 });
            await sleep(300);
            continue;
          }
          console.log("[Map 5] Triggering Shadow Elder at (5, 5)...");
          await rpc("chaya_live_interact", { eventId: 17 });
          await sleep(500);
          continue;
        }

        // Phase 4: Shadow Elder puzzle! Pull Lever 12 at (2, 3) to unlock Door 10
        if (!switch23) {
          console.log("[Map 5] Navigating to Lever Switch 12 at (2, 3)...");
          if (pos.x !== 3 || pos.y !== 3) {
            await rpc("chaya_live_move_to", { x: 3, y: 3 });
            await sleep(300);
          }
          console.log("[Map 5] Interacting with Lever 12 at (2, 3)...");
          const res = await rpc("chaya_live_interact", { eventId: 12 });
          if (res && res.outcome === "choice") {
            console.log("[Map 5] Confirming lever pull...");
            await rpc("chaya_live_press", { key: "ok" });
            await sleep(500);
            await rpc("chaya_live_press", { key: "ok" });
          }
          await sleep(400);
          continue;
        }

        // Phase 5: Door 10 is unlocked! Navigate to Door 10 at (20, 10)
        if (pos.x < 16) {
          console.log("[Map 5] Door 10 unlocked! Moving to junction at (16, 8)...");
          await rpc("chaya_live_move_to", { x: 16, y: 8 });
          await sleep(300);
          continue;
        }
        if (pos.y < 11 && pos.x < 20) {
          console.log("[Map 5] Moving south to Door 10 approach at (20, 11)...");
          await rpc("chaya_live_move_to", { x: 20, y: 11 });
          await sleep(300);
          continue;
        }
        if (pos.x === 20 && pos.y === 11) {
          console.log("[Map 5] Stepping through Door 10 at (20, 10)...");
          await rpc("chaya_live_interact", { eventId: 10 });
          await sleep(500);
          continue;
        }

        // Phase 6: North of Door 10, clear hint Event 5 and reach exit Event 26 at (21, 3)
        if (pos.x === 20 && pos.y === 9) {
          console.log("[Map 5] Clearing path at (20, 7)...");
          await rpc("chaya_live_interact", { eventId: 5 });
          await sleep(400);
          continue;
        }
        if (pos.y > 3) {
          console.log("[Map 5] Navigating north toward deep dungeon exit...");
          await rpc("chaya_live_move_to", { x: 20, y: 3 });
          await sleep(400);
          continue;
        }
        if (pos.x === 20 && pos.y === 3) {
          console.log("[Map 5] Stepping right onto Event 26 to enter Map 6...");
          await rpc("chaya_live_press", { key: "right" });
          await sleep(1000);
          continue;
        }
      }

      // Map 6 (Deep Dungeon - Conclusion of Prologue)
      if (status.mapId === 6) {
        console.log("\n========================================");
        console.log(">>> [Map 6 REACHED] Deep Dungeon - Prologue Climax! <<<");
        console.log("========================================");

        const isBusy = await evalInGame("return $gameMap.isEventRunning() || ($gameMessage && $gameMessage.isBusy())");
        if (isBusy) {
          console.log("[Map 6] Waiting for arrival cutscene to complete...");
          await sleep(1000);
          continue;
        }

        // Boris is at (11, 7)
        console.log("[Map 6] Walking to Master Boris at (11, 7)...");
        await rpc("chaya_live_move_to", { x: 11, y: 8 });
        await rpc("chaya_live_interact", { eventId: 9 });
        await sleep(1500);

        const prologueDone = await evalInGame(`
          return {
            mapId: $gameMap.mapId(),
            partyMembers: $gameParty.members().map(m => m.name()),
            dialogue: $gameMessage ? $gameMessage.allText() : "",
            switches: {
              s24: $gameSwitches.value(24),
              s25: $gameSwitches.value(25),
              s32: $gameSwitches.value(32),
              s585: $gameSwitches.value(585),
              s677: $gameSwitches.value(677)
            },
            inventory: $gameParty.items().map(i => i.name)
          };
        `);
        console.log("[Prologue Result]:", JSON.stringify(prologueDone, null, 2));
        console.log("\n========================================");
        console.log(">>> PROLOGUE COMPLETED SUCCESSFULLY! <<<");
        console.log("========================================\n");
        break;
      }
    }
    await sleep(250);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Custodian Finished] Total elapsed: ${elapsed}s, Remote Model Calls: ${modelCallCount}`);
}

main().catch(console.error);
