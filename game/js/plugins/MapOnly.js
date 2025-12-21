(() => {
    const a = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function () {
        a.call(this);
        DataManager.setupNewGame();
        SceneManager.goto(Scene_Map);
    };

    Scene_Map.prototype.isMenuCalled = function () {
        return false;
    };

    const b = Scene_Map.prototype.updateCallMenu;
    Scene_Map.prototype.updateCallMenu = function () {
        return;
    };

    const c = Scene_Map.prototype.callMenu;
    Scene_Map.prototype.callMenu = function () {
        return;
    };

    ConfigManager.touchUI = false;
})();
