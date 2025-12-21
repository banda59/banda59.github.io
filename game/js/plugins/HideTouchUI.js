(() => {
    'use strict';

    ConfigManager.touchUI = false;

    const _makeData = ConfigManager.makeData;
    ConfigManager.makeData = function () {
        const c = _makeData.call(this);
        c.touchUI = false;
        return c;
    };

    const _applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
        _applyData.call(this, config);
        this.touchUI = false;
    };

    Scene_Map.prototype.createButtons = function () {
    };

    Scene_Battle.prototype.createButtons = function () {
    };

    Scene_Map.prototype.updateCallMenu = function () {
    };
})();
