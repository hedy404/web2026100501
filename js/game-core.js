/**
 * 游戏核心逻辑（纯逻辑，不接触 DOM，可单独测试）。
 *
 * 一局的结构：
 *   1. 从 EmojiPool 里随机抽出 `candidateCount` 个 emoji 作为本局的「候选栏」；
 *   2. 再从这个候选栏里生成定长谜底（默认不允许重复）；
 * 因此每局的 emoji 集合和谜底都是随机的。
 *
 * 判定规则（Mastermind 式）：
 *   - 命中(exact)      ：位置和 emoji 都正确
 *   - 错位(misplaced)  ：emoji 在谜底里存在，但放错了位置
 * 只有 exact 等于谜面长度时才算全部猜对。
 */
(function (global) {
  'use strict';

  var MIN_SIZE = 3;
  var MAX_SIZE = 20;
  var DEFAULT_SIZE = 6;
  var DEFAULT_ALLOW_DUPLICATES = false;

  function clampSize(value) {
    var n = Math.floor(Number(value));
    if (!isFinite(n)) return DEFAULT_SIZE;
    if (n < MIN_SIZE) return MIN_SIZE;
    if (n > MAX_SIZE) return MAX_SIZE;
    return n;
  }

  /**
   * 候选栏数量：至少要和谜面一样长（否则凑不出不重复的谜底），
   * 至多等于 emoji 池子大小。
   */
  function clampCandidateCount(value, size, poolLength) {
    var n = Math.floor(Number(value));
    if (!isFinite(n)) n = size;
    if (n < size) n = size;
    var max = Math.max(size, poolLength);
    if (n > max) n = max;
    return n;
  }

  /** Fisher-Yates 洗牌，返回新数组 */
  function shuffle(source, rng) {
    var arr = source.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** 从池子里随机抽出本局的候选栏 */
  function pickCandidates(pool, count, rng) {
    var random = rng || Math.random;
    return shuffle(pool, random).slice(0, Math.min(count, pool.length));
  }

  /**
   * 由候选栏生成谜底。
   * @param {string[]} candidates 本局候选 emoji
   * @param {number} size 谜面长度
   * @param {boolean} allowDuplicates 谜底是否允许同一个 emoji 重复出现
   */
  function makeAnswer(candidates, size, allowDuplicates, rng) {
    var random = rng || Math.random;
    if (!candidates.length) return [];

    if (allowDuplicates) {
      var answer = [];
      for (var i = 0; i < size; i++) {
        answer.push(candidates[Math.floor(random() * candidates.length)]);
      }
      return answer;
    }

    if (size <= candidates.length) {
      return shuffle(candidates, random).slice(0, size);
    }

    // 候选比谜面短（正常配置下不会出现，仅作兜底）
    var padded = shuffle(candidates, random);
    while (padded.length < size) {
      padded.push(candidates[Math.floor(random() * candidates.length)]);
    }
    return padded;
  }

  /** 比较一次猜测与谜面 */
  function evaluateGuess(guess, answer) {
    var exact = 0;
    var answerCount = Object.create(null);
    var guessCount = Object.create(null);
    var i;

    for (i = 0; i < guess.length; i++) {
      if (guess[i] === answer[i]) {
        exact++;
      } else {
        answerCount[answer[i]] = (answerCount[answer[i]] || 0) + 1;
        guessCount[guess[i]] = (guessCount[guess[i]] || 0) + 1;
      }
    }

    var misplaced = 0;
    Object.keys(guessCount).forEach(function (key) {
      var matched = Math.min(guessCount[key], answerCount[key] || 0);
      misplaced += matched;
    });

    return { exact: exact, misplaced: misplaced };
  }

  /** 把毫秒格式化成 mm:ss 或 hh:mm:ss */
  function formatDuration(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return (hours > 0 ? hours + ':' : '') + pad(minutes) + ':' + pad(seconds);
  }

  /** 一局游戏的状态机 */
  function Game(options) {
    var opts = options || {};
    this.pool = opts.pool || [];
    this.rng = opts.rng || Math.random;
    this.size = clampSize(opts.size);
    this.candidateCount = clampCandidateCount(opts.candidateCount, this.size, this.pool.length);
    this.allowDuplicates = opts.allowDuplicates === undefined
      ? DEFAULT_ALLOW_DUPLICATES
      : !!opts.allowDuplicates;
    this.reset();
  }

  /** 开一局新的：重抽候选栏 + 重掷谜底 + 清空进度 */
  Game.prototype.reset = function (overrides) {
    if (overrides) {
      if (overrides.size !== undefined) this.size = clampSize(overrides.size);
      if (overrides.candidateCount !== undefined) {
        this.candidateCount = clampCandidateCount(overrides.candidateCount, this.size, this.pool.length);
      }
      if (overrides.allowDuplicates !== undefined) {
        this.allowDuplicates = !!overrides.allowDuplicates;
      }
    }
    this.size = clampSize(this.size);
    this.candidateCount = clampCandidateCount(this.candidateCount, this.size, this.pool.length);

    this.candidates = pickCandidates(this.pool, this.candidateCount, this.rng);
    this.answer = makeAnswer(this.candidates, this.size, this.allowDuplicates, this.rng);

    this.selection = [];
    this.guesses = [];
    this.attempts = 0;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.won = false;
    return this;
  };

  Game.prototype.isFull = function () {
    return this.selection.length >= this.size;
  };

  Game.prototype.isFinished = function () {
    return this.won;
  };

  /** 当前已选里某个 emoji 出现的次数 */
  Game.prototype.countSelected = function (char) {
    var count = 0;
    for (var i = 0; i < this.selection.length; i++) {
      if (this.selection[i] === char) count++;
    }
    return count;
  };

  /**
   * 选择一个 emoji。
   * @returns {{ok:boolean, reason?:string}}
   */
  Game.prototype.pick = function (char) {
    if (this.won) return { ok: false, reason: 'finished' };
    if (this.isFull()) return { ok: false, reason: 'full' };
    if (this.candidates.indexOf(char) === -1) return { ok: false, reason: 'unknown' };
    if (!this.allowDuplicates && this.countSelected(char) > 0) {
      return { ok: false, reason: 'duplicate' };
    }
    this.selection.push(char);
    return { ok: true };
  };

  Game.prototype.removeAt = function (index) {
    if (this.won) return false;
    if (index < 0 || index >= this.selection.length) return false;
    this.selection.splice(index, 1);
    return true;
  };

  Game.prototype.undo = function () {
    if (this.won) return false;
    return this.removeAt(this.selection.length - 1);
  };

  Game.prototype.clearSelection = function () {
    if (this.won) return false;
    var had = this.selection.length > 0;
    this.selection = [];
    return had;
  };

  /** 只清空记录框里的历史组合，不影响猜测次数与谜底 */
  Game.prototype.clearHistory = function () {
    var had = this.guesses.length > 0;
    this.guesses = [];
    return had;
  };

  /**
   * 提交当前选择。
   * @returns {?object} 记录对象；选择未满时返回 null
   */
  Game.prototype.submit = function () {
    if (this.won || !this.isFull()) return null;
    var result = evaluateGuess(this.selection, this.answer);
    this.attempts++;
    var record = {
      index: this.attempts,
      emojis: this.selection.slice(),
      exact: result.exact,
      misplaced: result.misplaced
    };
    this.guesses.push(record);
    this.selection = [];
    if (record.exact === this.size) {
      this.won = true;
      this.finishedAt = Date.now();
    }
    return record;
  };

  /** 本局统计信息（用于记分牌） */
  Game.prototype.stats = function () {
    return {
      size: this.size,
      candidateCount: this.candidateCount,
      allowDuplicates: this.allowDuplicates,
      candidates: this.candidates.slice(),
      attempts: this.attempts,
      durationMs: (this.finishedAt || Date.now()) - this.startedAt,
      answer: this.answer.slice(),
      guesses: this.guesses.slice(),
      won: this.won
    };
  };

  global.EmojiGameCore = {
    MIN_SIZE: MIN_SIZE,
    MAX_SIZE: MAX_SIZE,
    DEFAULT_SIZE: DEFAULT_SIZE,
    DEFAULT_ALLOW_DUPLICATES: DEFAULT_ALLOW_DUPLICATES,
    clampSize: clampSize,
    clampCandidateCount: clampCandidateCount,
    shuffle: shuffle,
    pickCandidates: pickCandidates,
    makeAnswer: makeAnswer,
    evaluateGuess: evaluateGuess,
    formatDuration: formatDuration,
    Game: Game
  };
})(window);
