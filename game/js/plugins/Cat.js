/*:
 * @target MZ
 * @plugindesc Play random cat SE on OK press when facing a cat event.
 *
 * @param seList
 * @type string[]
 * @default ["cat1","cat2","cat3","cat4"]
 *
 * @param volume
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param pitch
 * @type number
 * @min 50
 * @max 150
 * @default 100
 *
 * @param pan
 * @type number
 * @min -100
 * @max 100
 * @default 0
 *
 * @param namePattern
 * @type string
 * @default ^Cat$
 *
 * @param cooldownFrames
 * @type number
 * @min 0
 * @default 10
 */

(() => {
    const p = PluginManager.parameters("CatRandomSE");
    const list = JSON.parse(p.seList || '["cat1","cat2","cat3","cat4"]');
    const vol = Number(p.volume || 20);
    const pit = Number(p.pitch || 100);
    const pan = Number(p.pan || 0);
    const pat = new RegExp(p.namePattern || "^Cat$");
    const cd = Number(p.cooldownFrames || 10);

    let t = 0;

    const pick = () => {
        if (!list || list.length === 0) return "";
        const i = Math.floor(Math.random() * list.length);
        return String(list[i] || "").trim();
    };

    const play = () => {
        if (t > 0) return;
        const n = pick();
        if (!n) return;
        AudioManager.playSe({ name: n, volume: vol, pitch: pit, pan: pan });
        t = cd;
    };

    const hit = () => {
        const m = $gameMap;
        const x0 = $gamePlayer.x;
        const y0 = $gamePlayer.y;
        const d = $gamePlayer.direction();
        const x1 = $gameMap.roundXWithDirection(x0, d);
        const y1 = $gameMap.roundYWithDirection(y0, d);

        const a = m.eventsXy(x1, y1);
        for (let i = 0; i < a.length; i++) {
            const e = a[i];
            const nm = e.event()?.name || "";
            if (pat.test(nm)) return true;
        }

        const b = m.eventsXy(x0, y0);
        for (let i = 0; i < b.length; i++) {
            const e = b[i];
            const nm = e.event()?.name || "";
            if (pat.test(nm)) return true;
        }

        return false;
    };

    const _update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _update.call(this);
        if (t > 0) t--;
    };

    const _btn = Game_Player.prototype.triggerButtonAction;
    Game_Player.prototype.triggerButtonAction = function () {
        const ok = _btn.call(this);
        if (Input.isTriggered("ok")) {
            if (hit()) play();
        }
        return ok;
    };
})();
