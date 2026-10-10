/**
 * 🎵 乐谱库 (Music Score App) - 高精度专业电子节拍器引擎
 * 基于 Web Audio API Lookahead 调度算法，毫秒级无延迟零漂移，原生物理合成多种高质感音色
 */

(function (window) {
  'use strict';

  const TEMPO_MARKINGS = [
    { name: 'Grave 庄板', min: 20, max: 40 },
    { name: 'Largo 广板', min: 41, max: 60 },
    { name: 'Adagio 柔板', min: 61, max: 76 },
    { name: 'Andante 行板', min: 77, max: 108 },
    { name: 'Moderato 中板', min: 109, max: 120 },
    { name: 'Allegro 快板', min: 121, max: 168 },
    { name: 'Presto 急板', min: 169, max: 200 },
    { name: 'Prestissimo 最急板', min: 201, max: 300 }
  ];

  class MetronomeEngine {
    constructor() {
      this.bpm = 100;
      this.beatsPerBar = 4;        // 拍号 (每小节拍数: 1, 2, 3, 4, 6)
      this.subdivision = 1;        // 细分 (1=四分, 2=八分, 3=三连音, 4=十六分)
      this.timbre = 'woodblock';    // 'woodblock' | 'bell' | 'digital' | 'rimshot'
      this.volume = 0.8;
      this.isPlaying = false;

      // AudioContext & Lookahead scheduling
      this.audioCtx = null;
      this.nextNoteTime = 0.0;
      this.currentSubdivisionIndex = 0;
      this.currentBeatIndex = 0;
      this.lookaheadInterval = 25;  // 调度器检查间隔 (ms)
      this.scheduleAheadTime = 0.1; // 预调度时间窗 (s)
      this.timerId = null;

      // Tap tempo
      this.tapTimes = [];

      // Listeners
      this.listeners = new Set();
      this.tickListeners = new Set();
    }

    initAudioContext() {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.audioCtx = new AudioCtx();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    }

    setBpm(newBpm) {
      this.bpm = Math.max(30, Math.min(260, Math.round(newBpm)));
      this.notifyState();
    }

    setBeatsPerBar(beats) {
      this.beatsPerBar = Math.max(1, Math.min(12, Number(beats) || 4));
      this.currentBeatIndex = 0;
      this.currentSubdivisionIndex = 0;
      this.notifyState();
    }

    setSubdivision(sub) {
      this.subdivision = Number(sub) || 1;
      this.notifyState();
    }

    setTimbre(timbre) {
      this.timbre = timbre || 'woodblock';
      this.notifyState();
    }

    setVolume(vol) {
      this.volume = Math.max(0, Math.min(1, Number(vol)));
      this.notifyState();
    }

    getTempoMarking() {
      const match = TEMPO_MARKINGS.find(m => this.bpm >= m.min && this.bpm <= m.max);
      return match ? match.name : 'Moderato 中板';
    }

    // ── Tap Tempo 算法 ──
    tap() {
      const now = performance.now();
      if (this.tapTimes.length > 0 && now - this.tapTimes[this.tapTimes.length - 1] > 2500) {
        this.tapTimes = [];
      }
      this.tapTimes.push(now);
      if (this.tapTimes.length > 5) this.tapTimes.shift();

      if (this.tapTimes.length >= 2) {
        let totalInterval = 0;
        for (let i = 1; i < this.tapTimes.length; i++) {
          totalInterval += (this.tapTimes[i] - this.tapTimes[i - 1]);
        }
        const avgInterval = totalInterval / (this.tapTimes.length - 1);
        const calcBpm = Math.round(60000 / avgInterval);
        this.setBpm(calcBpm);
      }
    }

    // ── 播放控制 ──
    start() {
      if (this.isPlaying) return;
      this.initAudioContext();
      this.isPlaying = true;
      this.currentBeatIndex = 0;
      this.currentSubdivisionIndex = 0;
      this.nextNoteTime = this.audioCtx.currentTime + 0.05;

      this.timerId = setInterval(() => this.scheduler(), this.lookaheadInterval);
      this.notifyState();
    }

    stop() {
      if (!this.isPlaying) return;
      this.isPlaying = false;
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
      this.notifyState();
    }

    toggle() {
      if (this.isPlaying) this.stop();
      else this.start();
    }

    // ── Lookahead 调度核心 ──
    scheduler() {
      if (!this.audioCtx) return;
      while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
        this.scheduleNote(this.currentBeatIndex, this.currentSubdivisionIndex, this.nextNoteTime);
        this.advanceNote();
      }
    }

    advanceNote() {
      const secondsPerBeat = 60.0 / this.bpm;
      const secondsPerSubdivision = secondsPerBeat / this.subdivision;
      this.nextNoteTime += secondsPerSubdivision;

      this.currentSubdivisionIndex++;
      if (this.currentSubdivisionIndex >= this.subdivision) {
        this.currentSubdivisionIndex = 0;
        this.currentBeatIndex++;
        if (this.currentBeatIndex >= this.beatsPerBar) {
          this.currentBeatIndex = 0;
        }
      }
    }

    scheduleNote(beatIndex, subIndex, time) {
      const isDownbeat = (beatIndex === 0 && subIndex === 0 && this.beatsPerBar > 1);
      const isMainBeat = (subIndex === 0);

      this.playTone(isDownbeat, isMainBeat, time);

      // UI 动画高亮对齐
      const delay = Math.max(0, (time - this.audioCtx.currentTime) * 1000);
      setTimeout(() => {
        if (!this.isPlaying) return;
        this.notifyTick({
          beatIndex,
          subIndex,
          isDownbeat,
          isMainBeat,
          beatsPerBar: this.beatsPerBar
        });
      }, delay);
    }

    // ── 原生物理声音合成器 ──
    playTone(isDownbeat, isMainBeat, time) {
      if (this.volume <= 0) return;
      const ctx = this.audioCtx;

      switch (this.timbre) {
        case 'woodblock':
          this.synthesizeWoodblock(ctx, isDownbeat, isMainBeat, time);
          break;
        case 'bell':
          this.synthesizeBell(ctx, isDownbeat, isMainBeat, time);
          break;
        case 'rimshot':
          this.synthesizeRimshot(ctx, isDownbeat, isMainBeat, time);
          break;
        case 'digital':
        default:
          this.synthesizeDigital(ctx, isDownbeat, isMainBeat, time);
          break;
      }
    }

    // 🪵 机械木鱼音色 (Classic Woodblock)
    synthesizeWoodblock(ctx, isDownbeat, isMainBeat, time) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      const baseFreq = isDownbeat ? 1200 : (isMainBeat ? 860 : 700);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * 1.5, time);
      osc.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.015);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(baseFreq, time);
      filter.Q.setValueAtTime(8, time);

      const peakGain = (isDownbeat ? 1.0 : (isMainBeat ? 0.75 : 0.45)) * this.volume;
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.exponentialRampToValueAtTime(peakGain, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + (isDownbeat ? 0.05 : 0.035));

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + 0.06);
    }

    // 🔔 琴钟重音音色 (Bell Accent)
    synthesizeBell(ctx, isDownbeat, isMainBeat, time) {
      if (isDownbeat) {
        // 第一拍清脆钟声双和声
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(2093, time); // C7
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(3135, time); // G7

        gain.gain.setValueAtTime(0.001, time);
        gain.gain.exponentialRampToValueAtTime(0.6 * this.volume, time + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(time);
        osc2.start(time);
        osc1.stop(time + 0.36);
        osc2.stop(time + 0.36);
      } else {
        // 弱拍机械木质滴答
        this.synthesizeWoodblock(ctx, false, isMainBeat, time);
      }
    }

    // ⚡ 电子高频滴答 (Digital Beep)
    synthesizeDigital(ctx, isDownbeat, isMainBeat, time) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const freq = isDownbeat ? 1760 : (isMainBeat ? 880 : 660); // A6 vs A5 vs E5
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);

      const peakGain = (isDownbeat ? 0.8 : (isMainBeat ? 0.5 : 0.28)) * this.volume;
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.linearRampToValueAtTime(peakGain, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + 0.04);
    }

    // 🥁 清脆鼓点 (Rimshot Click)
    synthesizeRimshot(ctx, isDownbeat, isMainBeat, time) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      const startFreq = isDownbeat ? 480 : 320;
      osc.frequency.setValueAtTime(startFreq, time);
      osc.frequency.exponentialRampToValueAtTime(60, time + 0.02);

      const peakGain = (isDownbeat ? 0.9 : 0.55) * this.volume;
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.linearRampToValueAtTime(peakGain, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + 0.035);
    }

    // ── 观察者事件 ──
    onChange(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    notifyState() {
      const state = {
        bpm: this.bpm,
        beatsPerBar: this.beatsPerBar,
        subdivision: this.subdivision,
        timbre: this.timbre,
        volume: this.volume,
        isPlaying: this.isPlaying,
        tempoMarking: this.getTempoMarking()
      };
      this.listeners.forEach(fn => {
        try { fn(state); } catch (e) { console.error(e); }
      });
    }

    onTick(fn) {
      this.tickListeners.add(fn);
      return () => this.tickListeners.delete(fn);
    }

    notifyTick(payload) {
      this.tickListeners.forEach(fn => {
        try { fn(payload); } catch (e) { console.error(e); }
      });
    }
  }

  window.MetronomeEngine = new MetronomeEngine();
})(window);
