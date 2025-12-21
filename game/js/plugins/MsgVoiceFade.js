(() => {
    const a = ["Talking1", "Talking2", "Talking3", "Talking4", "Talking5"];
    const v = 90, p = 100, pan = 0;

    const _s = Window_Message.prototype.startMessage;
    Window_Message.prototype.startMessage = function () {
        const n = a[(Math.random() * a.length) | 0];
        AudioManager.playSe({ name: n, volume: v, pitch: p, pan: pan });
        _s.call(this);
    };
})();
