/**
 * 游戏核心逻辑（纯逻辑，不接触 DOM，可单独测试）。
 *
 * 一局的结构：
 *   1. 从 EmojiPool 里随机抽出 `candidateCount` 个 emoji 作为本局的「候选栏」；
 *   2. 再从这个候选栏里生成定长谜底（默认不允许重复）；
 * 因此每局的 emoji 集合和谜底都是随机的。
 *
 * 槽位与锁定：
 *   slots 是长度等于谜面长度的数组，每项为 null（空）或 emoji 字符；
 *   locks 是同长度的布尔数组，锁的是「位置」而不是内容：
 *     - 空槽也能锁定，锁定的空槽填 emoji 时和普通空槽一样会被填上；
 *     - 已锁定且已填的槽位是「钉住」的：撤销、清除、判定都不会动它。
 *   只有新开一局才会清空全部槽位并解除全部锁定。
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

  /** 开一局新的：重抽候选栏 + 重掷谜底 + 清空所有槽位（锁定一并解除） */
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

    this.slots = [];
    this.locks = [];
    for (var i = 0; i < this.size; i++) {
      this.slots.push(null);
      this.locks.push(false);
    }

    this.guesses = [];
    this.attempts = 0;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.won = false;
    // 刚刚提交过、槽位还没被改动过：用于挡住「选满自动判定」的重复触发
    this.awaitingChange = false;
    return this;
  };

  /* ---------------- 槽位查询 ---------------- */

  /** 第一个空槽位的下标，全满时返回 -1 */
  Game.prototype.firstEmptyIndex = function () {
    for (var i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) return i;
    }
    return -1;
  };

  Game.prototype.isFull = function () {
    return this.firstEmptyIndex() === -1;
  };

  Game.prototype.isFinished = function () {
    return this.won;
  };

  /** 已填数量（含锁定） */
  Game.prototype.filledCount = function () {
    var n = 0;
    for (var i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) n++;
    }
    return n;
  };

  /** 锁定的位置数量（空位也算，因为锁的是位置） */
  Game.prototype.lockedCount = function () {
    var n = 0;
    for (var i = 0; i < this.locks.length; i++) {
      if (this.locks[i]) n++;
    }
    return n;
  };

  /** 已锁定并且已经填了 emoji 的位置数量 */
  Game.prototype.lockedFilledCount = function () {
    var n = 0;
    for (var i = 0; i < this.slots.length; i++) {
      if (this.slots[i] && this.locks[i]) n++;
    }
    return n;
  };

  /** 是否存在可以撤销 / 清除的槽位（非空且未锁定） */
  Game.prototype.hasRemovable = function () {
    for (var i = 0; i < this.slots.length; i++) {
      if (this.slots[i] && !this.locks[i]) return true;
    }
    return false;
  };

  /** 按槽位顺序取出已填的 emoji（忽略空洞） */
  Game.prototype.values = function () {
    var out = [];
    for (var i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) out.push(this.slots[i]);
    }
    return out;
  };

  /** 某个 emoji 在槽位里出现的次数 */
  Game.prototype.countSelected = function (char) {
    var n = 0;
    for (var i = 0; i < this.slots.length; i++) {
      if (this.slots[i] === char) n++;
    }
    return n;
  };

  Game.prototype.isLocked = function (index) {
    return this.locks[index] === true;
  };

  /* ---------------- 操作 ---------------- */

  /**
   * 选一个 emoji，放进第一个空槽位（锁定的空位也照常填）。
   * @returns {{ok:boolean, reason?:string, index?:number}}
   */
  Game.prototype.pick = function (char) {
    if (this.won) return { ok: false, reason: 'finished' };

    var index = this.firstEmptyIndex();
    if (index === -1) return { ok: false, reason: 'full' };
    if (this.candidates.indexOf(char) === -1) return { ok: false, reason: 'unknown' };
    if (!this.allowDuplicates && this.countSelected(char) > 0) {
      return { ok: false, reason: 'duplicate' };
    }

    this.slots[index] = char;
    this.awaitingChange = false;
    return { ok: true, index: index };
  };

  /** 移除指定槽位；锁定的槽位移不动 */
  Game.prototype.removeAt = function (index) {
    if (this.won) return false;
    if (index < 0 || index >= this.slots.length) return false;
    if (!this.slots[index] || this.locks[index]) return false;
    this.slots[index] = null;
    this.awaitingChange = false;
    return true;
  };

  /** 从后往前移除最后一个「未锁定」的 emoji */
  Game.prototype.undo = function () {
    if (this.won) return false;
    for (var i = this.slots.length - 1; i >= 0; i--) {
      if (this.slots[i] && !this.locks[i]) {
        this.slots[i] = null;
        this.awaitingChange = false;
        return true;
      }
    }
    return false;
  };

  /** 清空所有「未锁定」位置的 emoji，锁定的原样保留 */
  Game.prototype.clearSelection = function () {
    if (this.won) return false;
    var changed = false;
    for (var i = 0; i < this.slots.length; i++) {
      if (this.slots[i] && !this.locks[i]) {
        this.slots[i] = null;
        changed = true;
      }
    }
    if (changed) this.awaitingChange = false;
    return changed;
  };

  /**
   * 切换某个位置的锁定状态。空位也能锁定（锁的是位置）。
   * @returns {?string} 'locked' | 'unlocked' | null（下标越界或本局已结束时返回 null）
   */
  Game.prototype.toggleLock = function (index) {
    if (this.won) return null;
    if (index < 0 || index >= this.locks.length) return null;
    this.locks[index] = !this.locks[index];
    this.awaitingChange = false;
    return this.locks[index] ? 'locked' : 'unlocked';
  };

  /** 只清空记录框里的历史组合，不影响猜测次数、谜底与槽位 */
  Game.prototype.clearHistory = function () {
    var had = this.guesses.length > 0;
    this.guesses = [];
    return had;
  };

  /**
   * 提交当前槽位（必须填满才允许）。
   * 判定后清掉所有未锁定的槽位，锁定的按原位置保留下来。
   * @returns {?object} 记录对象；未填满时返回 null
   */
  Game.prototype.submit = function () {
    if (this.won || !this.isFull()) return null;

    var values = this.values();
    var result = evaluateGuess(values, this.answer);
    this.attempts++;

    var record = {
      index: this.attempts,
      emojis: values,
      exact: result.exact,
      misplaced: result.misplaced
    };
    this.guesses.push(record);

    var kept = 0;
    for (var i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) continue;
      if (this.locks[i]) {
        kept++;
      } else {
        this.slots[i] = null;
      }
    }
    record.keptLocked = kept;
    this.awaitingChange = true;

    if (record.exact === this.size) {
      this.won = true;
      this.finishedAt = Date.now();
    }
    return record;
  };

  /** 是否处于「可以立即自动判定」的状态（刚提交过就不算） */
  Game.prototype.canAutoSubmit = function () {
    return this.isFull() && !this.awaitingChange;
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
