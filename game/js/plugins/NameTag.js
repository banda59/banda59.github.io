(() => {
    const pn = (() => {
        const s = document.currentScript;
        if (!s) return "NameTag";
        const m = (s.src || "").match(/([^/]+)\.js$/);
        return m ? m[1] : "NameTag";
    })();

    const p = PluginManager.parameters(pn) || {};
    const sp = (p.showPlayer ?? "true") === "true";
    const se = (p.showEvents ?? "true") === "true";
    const fs = Number(p.fontSize ?? 18);
    const yo = Number(p.yOffset ?? -52);
    const oc = String(p.outlineColor ?? "#000000");
    const ow = Number(p.outlineWidth ?? 8);
    const tc = String(p.textColor ?? "#8B5CF6");

    function evLabel(ev) {
        const n = (ev.event() && ev.event().name) ? ev.event().name : "";
        if (!n) return "";
        if (n.startsWith("door_")) return n.slice(5).toUpperCase();
        if (n.startsWith("sign_")) return n.slice(5).toUpperCase();
        return n;
    }

    class Sprite_NameTag extends Sprite {
        constructor() {
            super();
            this.bitmap = new Bitmap(1, 1);
            this.anchor.x = 0.5;
            this.anchor.y = 1.0;
            this._t = "";
        }
        setText(t) {
            t = String(t || "");
            if (this._t === t) return;
            this._t = t;

            if (!t) {
                this.bitmap.resize(1, 1);
                this.visible = false;
                return;
            }

            this.bitmap.fontSize = fs;
            const w = Math.max(1, Math.ceil(this.bitmap.measureTextWidth(t)) + ow * 4);
            const h = Math.max(1, fs + ow * 2);

            this.bitmap.resize(w, h);
            this.bitmap.clear();
            this.bitmap.fontSize = fs;

            this.bitmap.textColor = tc;
            this.bitmap.outlineColor = oc;
            this.bitmap.outlineWidth = ow;
            this.bitmap.drawText(t, 0, 0, w, h, "center");

            this.visible = true;
        }
    }

    const _init = Sprite_Character.prototype.initMembers;
    Sprite_Character.prototype.initMembers = function () {
        _init.call(this);
        this._nt = null;
    };

    const _upd = Sprite_Character.prototype.update;
    Sprite_Character.prototype.update = function () {
        _upd.call(this);

        const c = this._character;
        if (!c) return;

        let t = "";

        if (sp && c === $gamePlayer) {
            const a = $gameParty.leader();
            t = a ? a.name() : "";
        } else if (se && c instanceof Game_Event) {
            t = evLabel(c);
        }

        if (!t) {
            if (this._nt) this._nt.visible = false;
            return;
        }

        if (!this._nt) {
            this._nt = new Sprite_NameTag();
            this.addChild(this._nt);
        }

        this._nt.x = 0;
        this._nt.y = yo;
        this._nt.setText(t);
    };
})();
