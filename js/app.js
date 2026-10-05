/**
 * Emoji 猜猜看 —— 界面与交互层
 * 依赖：window.EmojiPool、window.EmojiGameCore
 */
(function () {
  'use strict';

  var Core = window.EmojiGameCore;
  var Pool = window.EmojiPool;

  var SETTINGS_KEY = 'emojiGuess.settings.v2';
  var BEST_KEY = 'emojiGuess.best.v2';

  var dom = {};
  var poolButtons = {};
  var game = null;
  var timerId = null;
  var autoTimerId = null;
  var toastTimerId = null;
  var confettiTimerId = null;

  var state = {
    size: Core.DEFAULT_SIZE,
    candidateCount: Core.DEFAULT_SIZE,
    followSize: true,
    allowDuplicates: Core.DEFAULT_ALLOW_DUPLICATES,
    autoSubmit: true,
    best: {}
  };

  /* ================= 小工具 ================= */

  function $(id) { return document.getElementById(id); }

  function loadJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* 隐私模式等场景下静默失败，不影响游戏 */
    }
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    clearTimeout(toastTimerId);
    toastTimerId = setTimeout(function () { dom.toast.hidden = true; }, 2200);
  }

  function restartAnimation(node, className) {
    node.classList.remove(className);
    void node.offsetWidth; // 强制重排以重启动画
    node.classList.add(className);
  }

  function bestKey(stats) {
    return stats.size + '|' + stats.candidateCount + '|' + (stats.allowDuplicates ? 'dup' : 'uniq');
  }

  function hasProgress() {
    return game && game.attempts > 0 && !game.won;
  }

  /* ================= 设置持久化 ================= */

  function loadSettings() {
    var saved = loadJSON(SETTINGS_KEY, null);
    if (saved) {
      state.size = Core.clampSize(saved.size);
      state.followSize = saved.followSize !== false;
      state.candidateCount = Core.clampCandidateCount(
        state.followSize ? state.size : saved.candidateCount,
        state.size,
        Pool.chars.length
      );
      state.allowDuplicates = saved.allowDuplicates === true;
      state.autoSubmit = saved.autoSubmit !== false;
    }
    state.best = loadJSON(BEST_KEY, {}) || {};
  }

  function saveSettings() {
    saveJSON(SETTINGS_KEY, {
      size: state.size,
      candidateCount: state.candidateCount,
      followSize: state.followSize,
      allowDuplicates: state.allowDuplicates,
      autoSubmit: state.autoSubmit
    });
  }

  function syncSettingsUI() {
    dom.sizeInput.value = String(game.size);
    dom.followToggle.checked = state.followSize;
    dom.candInput.value = String(game.candidateCount);
    dom.dupToggle.checked = game.allowDuplicates;
    dom.autoToggle.checked = state.autoSubmit;
    dom.difficultyText.textContent = game.size + ' 位 · ' + game.candidateCount + ' 候选 · ' +
      (game.allowDuplicates ? '可重复' : '不重复');
    syncSettingsPreview();
  }

  /** 设置弹窗内控件的即时联动（此时改动还没应用到游戏） */
  function syncSettingsPreview() {
    var following = dom.followToggle.checked;
    dom.candInput.disabled = following;
    dom.candMinus.disabled = following;
    dom.candPlus.disabled = following;
    dom.candStepper.classList.toggle('is-locked', following);
    if (following) dom.candInput.value = String(Core.clampSize(dom.sizeInput.value));
  }

  /* ================= 渲染：槽位 ================= */

  function renderBoard(popIndex) {
    var reveal = game.won;
    var values = reveal ? game.answer : game.slots;

    dom.board.innerHTML = '';

    for (var i = 0; i < game.size; i++) {
      var cell = document.createElement('div');
      cell.className = 'slot';
      cell.setAttribute('role', 'listitem');

      var char = values[i] || null;
      var locked = !reveal && game.isLocked(i);

      if (char) {
        cell.classList.add('filled');
        cell.textContent = char;
      } else {
        cell.classList.add('empty');
        cell.textContent = String(i + 1);
      }

      if (reveal) {
        cell.classList.add('solved', 'wave');
        cell.style.animationDelay = (i * 0.06).toFixed(2) + 's';
        if (char) cell.title = Pool.nameOf(char);
      } else {
        // 空位也能锁定：锁的是位置，填入的 emoji 会继承这个位置上的锁定
        var label = '第 ' + (i + 1) + ' 位 ' + (char ? Pool.nameOf(char) : '空位');

        cell.classList.add('clickable');
        cell.tabIndex = 0;
        cell.setAttribute('aria-pressed', locked ? 'true' : 'false');

        if (locked) {
          cell.classList.add('locked');
          cell.title = label + ' · 已锁定（点击解锁）';
          cell.setAttribute('aria-label', label + '，已锁定，按回车解锁');
          var lockMark = document.createElement('span');
          lockMark.className = 'slot-lock';
          lockMark.setAttribute('aria-hidden', 'true');
          lockMark.textContent = '🔒';
          cell.appendChild(lockMark);
        } else {
          cell.title = label + '（点击锁定）';
          cell.setAttribute('aria-label', label + '，未锁定，按回车锁定');
        }

        (function (index) {
          var toggle = function () { toggleLockAt(index); };
          cell.addEventListener('click', toggle);
          cell.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggle();
            }
          });
        })(i);
      }

      if (popIndex === i) cell.classList.add('pop');
      dom.board.appendChild(cell);
    }
  }

  /* ================= 渲染：候选栏 ================= */

  /** 候选栏每局都不一样，所以整块重建 */
  function rebuildPool() {
    dom.pool.innerHTML = '';
    poolButtons = {};

    // 候选不多时放宽单格上限，让待选栏更饱满
    dom.pool.classList.toggle('pool--few', game.candidates.length <= 8);

    game.candidates.forEach(function (char) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pool-btn';
      btn.textContent = char;
      btn.title = Pool.nameOf(char);
      btn.dataset.char = char;
      btn.setAttribute('aria-label', Pool.nameOf(char));
      btn.addEventListener('click', function () { pick(char, btn); });
      dom.pool.appendChild(btn);
      poolButtons[char] = btn;
    });
  }

  function updatePool() {
    game.candidates.forEach(function (char) {
      var btn = poolButtons[char];
      if (!btn) return;
      var count = game.countSelected(char);
      var blocked = game.won || game.isFull() || (!game.allowDuplicates && count > 0);

      btn.classList.toggle('blocked', blocked);
      btn.classList.toggle('used-nodup', !game.allowDuplicates && count > 0);
      btn.setAttribute('aria-pressed', count > 0 ? 'true' : 'false');

      var badge = btn.querySelector('.badge');
      if (count > 1) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'badge';
          btn.appendChild(badge);
        }
        badge.textContent = '×' + count;
      } else if (badge) {
        badge.remove();
      }
    });
  }

  /* ================= 渲染：记录框 ================= */

  function makeRecordRow(record, total) {
    var li = document.createElement('li');
    var perfect = record.exact === (total || record.emojis.length);
    var useful = record.exact > 0 || record.misplaced > 0;
    li.className = 'rec-row' + (perfect ? ' hit' : (useful ? ' warm' : ''));

    var index = document.createElement('span');
    index.className = 'rec-index';
    index.textContent = '#' + record.index;

    var emojis = document.createElement('span');
    emojis.className = 'rec-emojis';
    emojis.textContent = record.emojis.join('');
    emojis.title = record.emojis.map(Pool.nameOf).join(' ');

    var exact = document.createElement('span');
    exact.className = 'rec-stat exact' + (record.exact === 0 ? ' zero' : '');
    exact.textContent = record.exact;

    var near = document.createElement('span');
    near.className = 'rec-stat near' + (record.misplaced === 0 ? ' zero' : '');
    near.textContent = record.misplaced;

    li.appendChild(index);
    li.appendChild(emojis);
    li.appendChild(exact);
    li.appendChild(near);
    return li;
  }

  function emptyRecordItem() {
    var li = document.createElement('li');
    li.className = 'records-empty';
    li.textContent = '还没有记录，先选中 emoji 试试看吧～';
    return li;
  }

  function renderRecords() {
    dom.records.innerHTML = '';
    if (game.guesses.length === 0) {
      dom.records.appendChild(emptyRecordItem());
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = game.guesses.length - 1; i >= 0; i--) {
      frag.appendChild(makeRecordRow(game.guesses[i], game.size));
    }
    dom.records.appendChild(frag);
  }

  function appendRecordRow(record) {
    var empty = dom.records.querySelector('.records-empty');
    if (empty) empty.remove();
    dom.records.insertBefore(makeRecordRow(record, game.size), dom.records.firstChild);
    dom.records.scrollTop = 0;
  }

  /* ================= 渲染：状态条与模式提示 ================= */

  function renderHud() {
    var elapsed = game.finishedAt ? game.finishedAt - game.startedAt : Date.now() - game.startedAt;
    var locked = game.lockedCount();

    dom.attemptCount.textContent = String(game.attempts);
    dom.timer.textContent = Core.formatDuration(elapsed);
    dom.selCount.textContent = String(game.filledCount());
    dom.sizeLabel.textContent = String(game.size);

    dom.lockCount.textContent = String(locked);
    dom.lockItem.hidden = locked === 0;

    dom.submitBtn.disabled = game.won || !game.isFull();
    dom.undoBtn.disabled = game.won || !game.hasRemovable();
    dom.clearBtn.disabled = game.won || !game.hasRemovable();
  }

  function renderModeTip() {
    var text;
    var hint;

    if (game.allowDuplicates) {
      text = '本局谜底允许重复：候选栏 ' + game.candidateCount + ' 个 emoji，谜面 ' + game.size + ' 位。';
    } else if (game.candidateCount === game.size) {
      text = '每个 emoji 恰好出现一次：把 ' + game.size + ' 个候选全部排进槽位。';
    } else {
      text = '谜底是候选里 ' + game.size + ' 个不重复的 emoji（候选共 ' + game.candidateCount + ' 个）。';
    }

    if (game.size <= 6) {
      hint = '点一下加入，点槽位可以 🔒 锁定';
    } else {
      hint = '要选 ' + game.size + ' 个：点一下加入，点槽位可以 🔒 锁定';
    }

    dom.modeTip.textContent = text;
    dom.modeTip.hidden = false;
    dom.poolHint.textContent = hint;
  }

  /* ================= 计时器 ================= */

  function startTimer() {
    stopTimer();
    timerId = window.setInterval(renderHud, 500);
    renderHud();
  }

  function stopTimer() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  /* ================= 操作 ================= */

  function cancelAutoSubmit() {
    if (autoTimerId) {
      window.clearTimeout(autoTimerId);
      autoTimerId = null;
    }
  }

  function pick(char, btn) {
    var result = game.pick(char);

    if (!result.ok) {
      restartAnimation(btn, 'shake');
      if (result.reason === 'full') {
        toast(game.lockedCount() === game.size
          ? '所有位置都锁定了 🔒，先点槽位解锁再改'
          : '已经选满 ' + game.size + ' 个啦，先撤销或清除');
      } else if (result.reason === 'duplicate') {
        toast('当前是「不允许重复」模式，' + Pool.nameOf(char) + ' 已经选过了');
      } else {
        toast('本局已结束，点「新游戏」开下一局');
      }
      return;
    }

    restartAnimation(btn, 'tap');
    renderBoard(result.index);
    renderHud();
    updatePool();
    maybeAutoSubmit();
  }

  /** 点槽位 = 锁定 / 解锁（空位也能锁，锁的是位置） */
  function toggleLockAt(index) {
    cancelAutoSubmit();
    var result = game.toggleLock(index);
    if (!result) return;

    renderBoard();
    renderHud();
    updatePool();

    var char = game.slots[index];
    if (result === 'locked') {
      toast(char
        ? '🔒 已锁定第 ' + (index + 1) + ' 位：' + Pool.nameOf(char) + '（撤销、清除、判定都不会动它）'
        : '🔒 已锁定第 ' + (index + 1) + ' 位（空位）：之后填进去的 emoji 同样不会被撤销或清除');
    } else {
      toast('已解锁第 ' + (index + 1) + ' 位' + (char ? '：' + Pool.nameOf(char) : ''));
    }
  }

  function undoOne() {
    cancelAutoSubmit();
    if (game.undo()) {
      renderBoard();
      renderHud();
      updatePool();
    } else if (game.lockedFilledCount() > 0) {
      toast('🔒 锁定的 emoji 不会被撤销，点槽位可以解锁');
    } else {
      toast('还没有可以撤销的 emoji');
    }
  }

  function clearSelection() {
    cancelAutoSubmit();
    var kept = game.lockedFilledCount();
    if (game.clearSelection()) {
      renderBoard();
      renderHud();
      updatePool();
      toast(kept > 0
        ? '已清除未锁定的 emoji，保留了 ' + kept + ' 个锁定中的 emoji 🔒'
        : '已清除全部已选 emoji');
    } else if (kept > 0) {
      toast('🔒 锁定的 emoji 不会被清除，点槽位可以解锁');
    } else if (game.lockedCount() > 0) {
      toast('目前只有锁定的空位，没有可以清除的 emoji');
    } else {
      toast('当前没有已选的 emoji');
    }
  }

  function maybeAutoSubmit() {
    cancelAutoSubmit();
    if (!state.autoSubmit || game.won || !game.canAutoSubmit()) return;
    autoTimerId = window.setTimeout(function () {
      autoTimerId = null;
      submitGuess();
    }, 240);
  }

  function flashBoard(className) {
    if (reducedMotion()) return;
    restartAnimation(dom.board, className);
  }

  function submitGuess() {
    cancelAutoSubmit();
    if (game.won) return;
    if (!game.isFull()) {
      toast('还要再选 ' + (game.size - game.filledCount()) + ' 个 emoji');
      return;
    }
    var record = game.submit();
    if (!record) return;

    appendRecordRow(record);
    renderBoard();
    renderHud();
    updatePool();

    if (game.won) {
      onWin();
      return;
    }

    var keptMsg = record.keptLocked > 0 ? '；锁定的 ' + record.keptLocked + ' 个已保留 🔒' : '';
    if (record.exact === 0 && record.misplaced === 0) {
      flashBoard('shake-board');
      toast('一个都没沾上，换个思路 🤔' + keptMsg);
    } else if (record.misplaced === 0 && record.exact > 0) {
      flashBoard('pulse-board');
      toast('位置全对的有 ' + record.exact + ' 个，继续缩小范围' + keptMsg);
    } else if (record.keptLocked > 0) {
      toast('锁定的 ' + record.keptLocked + ' 个已保留 🔒，继续调整其余位置');
    }
  }

  /* ================= 胜利动画 ================= */

  function burstConfetti() {
    if (reducedMotion()) return;

    var layer = dom.confetti;
    layer.textContent = '';

    var colors = ['#6c7bff', '#8f7bff', '#35d07f', '#ffb648', '#ff6b81', '#5ad1ff', '#ffe066'];
    var count = window.innerWidth < 620 ? 46 : 86;

    for (var i = 0; i < count; i++) {
      var piece = document.createElement('i');
      piece.className = 'confetti-piece';
      piece.style.left = (Math.random() * 100).toFixed(2) + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.width = (5 + Math.random() * 7).toFixed(1) + 'px';
      piece.style.height = (9 + Math.random() * 10).toFixed(1) + 'px';
      piece.style.animationDelay = (Math.random() * 0.8).toFixed(2) + 's';
      piece.style.animationDuration = (2.1 + Math.random() * 1.7).toFixed(2) + 's';
      piece.style.setProperty('--spin', Math.round(Math.random() * 900 - 450) + 'deg');
      piece.style.setProperty('--drift', Math.round(Math.random() * 180 - 90) + 'px');
      layer.appendChild(piece);
    }

    if (confettiTimerId) window.clearTimeout(confettiTimerId);
    confettiTimerId = window.setTimeout(function () {
      layer.textContent = '';
      confettiTimerId = null;
    }, 5200);
  }

  /** 记分牌里的谜底逐格翻出来 */
  function renderAnswerReveal(answer) {
    dom.scoreAnswer.textContent = '';
    answer.forEach(function (char, i) {
      var span = document.createElement('span');
      span.className = 'reveal-emoji';
      span.textContent = char;
      span.title = Pool.nameOf(char);
      span.style.animationDelay = (0.14 + i * 0.06).toFixed(2) + 's';
      dom.scoreAnswer.appendChild(span);
    });
  }

  /* ================= 记分牌 ================= */

  function medalFor(attempts, size) {
    if (attempts <= 1) return '🎊 一发入魂！';
    if (attempts <= Math.max(2, Math.ceil(size / 2))) return '🚀 神速破译！';
    if (attempts <= size) return '👍 稳扎稳打！';
    if (attempts <= size * 2) return '🙂 顺利拿下！';
    return '😅 千辛万苦，终于是你的了！';
  }

  function onWin() {
    stopTimer();
    if (!dom.settingsModal.hidden) closeSettings(true);
    renderBoard();

    var stats = game.stats();
    var key = bestKey(stats);
    var previous = state.best[key] || null;
    var isNewBest = !previous ||
      stats.attempts < previous.attempts ||
      (stats.attempts === previous.attempts && stats.durationMs < previous.durationMs);

    if (isNewBest) {
      state.best[key] = {
        attempts: stats.attempts,
        durationMs: stats.durationMs,
        at: Date.now()
      };
      saveJSON(BEST_KEY, state.best);
    }

    showScoreboard(stats, isNewBest, previous);
    burstConfetti();
  }

  function showScoreboard(stats, isNewBest, previous) {
    dom.scoreMedal.textContent = medalFor(stats.attempts, stats.size);
    renderAnswerReveal(stats.answer);
    dom.scoreAttempts.textContent = stats.attempts + ' 次';
    dom.scoreTime.textContent = Core.formatDuration(stats.durationMs);
    dom.scoreDifficulty.textContent = stats.size + ' 位 · ' + stats.candidateCount + ' 候选 · ' +
      (stats.allowDuplicates ? '可重复' : '不重复');

    var bestCell = dom.scoreBest.parentNode;
    bestCell.classList.toggle('new-best', isNewBest);
    var bestText = '—';
    if (isNewBest) {
      bestText = stats.attempts + ' 次 / ' + Core.formatDuration(stats.durationMs) + ' 🎉';
    } else if (previous) {
      bestText = previous.attempts + ' 次 / ' + Core.formatDuration(previous.durationMs);
    }
    dom.scoreBest.textContent = bestText;

    dom.scoreHistory.innerHTML = '';
    if (stats.guesses.length === 0) {
      var li = document.createElement('li');
      li.className = 'records-empty';
      li.textContent = '（记录框已被清空）';
      dom.scoreHistory.appendChild(li);
    } else {
      var frag = document.createDocumentFragment();
      stats.guesses.forEach(function (record) {
        frag.appendChild(makeRecordRow(record, stats.size));
      });
      dom.scoreHistory.appendChild(frag);
    }

    dom.scoreboard.hidden = false;
    dom.scoreboard.classList.remove('closing');
    syncBodyLock();
    dom.playAgainBtn.focus();
  }

  function closeScoreboard(immediate) {
    if (dom.scoreboard.hidden) return;

    if (immediate || reducedMotion()) {
      dom.scoreboard.hidden = true;
      dom.scoreboard.classList.remove('closing');
      syncBodyLock();
      return;
    }

    dom.scoreboard.classList.add('closing');
    window.setTimeout(function () {
      dom.scoreboard.hidden = true;
      dom.scoreboard.classList.remove('closing');
      syncBodyLock();
    }, 190);
  }

  /* ================= 设置弹窗 ================= */

  /** 只要有任意弹窗打开就锁住页面滚动 */
  function syncBodyLock() {
    var anyOpen = !dom.scoreboard.hidden || !dom.settingsModal.hidden;
    document.body.classList.toggle('modal-open', anyOpen);
  }

  function openSettings() {
    syncSettingsUI();

    var progress = hasProgress();
    dom.settingsWarning.hidden = !progress;
    if (progress) {
      dom.settingsWarning.textContent = '本局已经猜了 ' + game.attempts +
        ' 次，应用新难度会重新开局并清空记录框。';
    }

    dom.settingsModal.hidden = false;
    dom.settingsModal.classList.remove('closing');
    syncBodyLock();
    dom.sizeInput.focus();
  }

  function closeSettings(immediate) {
    if (dom.settingsModal.hidden) return;
    syncSettingsUI(); // 丢弃没有应用的改动

    if (immediate || reducedMotion()) {
      dom.settingsModal.hidden = true;
      dom.settingsModal.classList.remove('closing');
      syncBodyLock();
      return;
    }

    dom.settingsModal.classList.add('closing');
    window.setTimeout(function () {
      dom.settingsModal.hidden = true;
      dom.settingsModal.classList.remove('closing');
      syncBodyLock();
    }, 190);
  }

  function applySettingsFromModal() {
    commitSettings({ force: true, silent: true });
    closeSettings(true);
    toast('设置已应用：' + game.size + ' 位 · ' + game.candidateCount + ' 候选 · ' +
      (game.allowDuplicates ? '允许重复' : '不重复'));
  }

  function buildResultText(stats) {
    var lines = [];
    lines.push('🎯 Emoji 猜猜看 · ' + stats.size + ' 位 · ' + stats.candidateCount + ' 候选 · ' +
      (stats.allowDuplicates ? '可重复' : '不重复'));
    lines.push('用时 ' + Core.formatDuration(stats.durationMs) + ' · 猜测 ' + stats.attempts + ' 次');
    lines.push('谜底：' + stats.answer.join(''));
    stats.guesses.forEach(function (guess) {
      lines.push(guess.index + '. ' + guess.emojis.join('') +
        '  命中 ' + guess.exact + ' / 错位 ' + guess.misplaced);
    });
    return lines.join('\n');
  }

  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { done(true); },
        function () { done(legacyCopy(text)); }
      );
    } else {
      done(legacyCopy(text));
    }
  }

  /* ================= 开局 / 设置 ================= */

  function newGame(silent, overrides) {
    cancelAutoSubmit();
    game.reset(overrides);
    closeScoreboard(true);
    if (!dom.settingsModal.hidden) closeSettings(true);
    dom.confetti.textContent = '';
    rebuildPool();
    renderRecords();
    renderBoard();
    renderModeTip();
    updatePool();
    startTimer();
    syncSettingsUI();

    if (!silent) {
      toast('新的一局：' + game.size + ' 位 · ' + game.candidateCount + ' 候选 · ' +
        (game.allowDuplicates ? '允许重复' : '不重复'));
    }
  }

  function readSettingsFromUI() {
    var size = Core.clampSize(dom.sizeInput.value);
    var followSize = dom.followToggle.checked;
    var candidateCount = followSize
      ? size
      : Core.clampCandidateCount(dom.candInput.value, size, Pool.chars.length);

    return {
      size: size,
      candidateCount: candidateCount,
      followSize: followSize,
      allowDuplicates: dom.dupToggle.checked,
      autoSubmit: dom.autoToggle.checked
    };
  }

  /**
   * 把界面上的设置落到 state（并持久化），必要时重新开局。
   * @param {{force?:boolean, toastMessage?:string}} options
   */
  function commitSettings(options) {
    var opts = options || {};
    var next = readSettingsFromUI();
    var needRestart = next.size !== game.size ||
      next.candidateCount !== game.candidateCount ||
      next.allowDuplicates !== game.allowDuplicates;

    if (needRestart && hasProgress() && !opts.force) {
      var ok = window.confirm('修改难度会立即重新开局，并清空记录框。继续吗？');
      if (!ok) {
        syncSettingsUI();
        return;
      }
    }

    state.size = next.size;
    state.candidateCount = next.candidateCount;
    state.followSize = next.followSize;
    state.allowDuplicates = next.allowDuplicates;
    state.autoSubmit = next.autoSubmit;
    saveSettings();

    if (needRestart) {
      newGame(true, {
        size: state.size,
        candidateCount: state.candidateCount,
        allowDuplicates: state.allowDuplicates
      });
      if (!opts.silent) {
        toast('已按新难度开局：' + game.size + ' 位 · ' + game.candidateCount + ' 候选 · ' +
          (game.allowDuplicates ? '允许重复' : '不重复'));
      }
    } else {
      syncSettingsUI();
      if (opts.toastMessage) toast(opts.toastMessage);
      maybeAutoSubmit();
    }
  }

  /** 只改输入框里的数字，是否生效由「应用并重开」决定 */
  function stepNumber(input, delta) {
    input.value = String(Math.floor(Number(input.value) || 0) + delta);
  }

  function normalizeSizeInput() {
    dom.sizeInput.value = String(Core.clampSize(dom.sizeInput.value));
    syncSettingsPreview();
  }

  function normalizeCandInput() {
    var size = Core.clampSize(dom.sizeInput.value);
    dom.candInput.value = String(Core.clampCandidateCount(dom.candInput.value, size, Pool.chars.length));
  }

  /* ================= 事件绑定 ================= */

  function bindEvents() {
    /* ---- 设置弹窗 ---- */
    dom.settingsOpenBtn.addEventListener('click', function () { openSettings(); });
    dom.difficultyChip.addEventListener('click', function () { openSettings(); });
    dom.settingsCancelBtn.addEventListener('click', function () { closeSettings(); });
    dom.applySettingsBtn.addEventListener('click', applySettingsFromModal);
    dom.settingsModal.addEventListener('click', function (event) {
      if (event.target === dom.settingsModal) closeSettings();
    });

    dom.sizeInput.addEventListener('change', normalizeSizeInput);
    dom.sizeInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        applySettingsFromModal();
      }
    });
    dom.sizeMinus.addEventListener('click', function () { stepNumber(dom.sizeInput, -1); normalizeSizeInput(); });
    dom.sizePlus.addEventListener('click', function () { stepNumber(dom.sizeInput, 1); normalizeSizeInput(); });

    dom.candInput.addEventListener('change', normalizeCandInput);
    dom.candInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        applySettingsFromModal();
      }
    });
    dom.candMinus.addEventListener('click', function () { stepNumber(dom.candInput, -1); normalizeCandInput(); });
    dom.candPlus.addEventListener('click', function () { stepNumber(dom.candInput, 1); normalizeCandInput(); });
    dom.followToggle.addEventListener('change', syncSettingsPreview);

    /* ---- 游戏操作 ---- */
    dom.newGameBtn.addEventListener('click', function () { newGame(); });

    dom.undoBtn.addEventListener('click', undoOne);
    dom.clearBtn.addEventListener('click', clearSelection);
    dom.submitBtn.addEventListener('click', submitGuess);

    dom.clearRecordsBtn.addEventListener('click', function () {
      if (game.clearHistory()) {
        renderRecords();
        toast('记录框已清空（猜测次数保留）');
      } else {
        toast('记录框本来就是空的');
      }
    });

    dom.playAgainBtn.addEventListener('click', function () { newGame(); });
    dom.closeScoreBtn.addEventListener('click', function () { closeScoreboard(); });
    dom.copyResultBtn.addEventListener('click', function () {
      copyText(buildResultText(game.stats()), function (ok) {
        toast(ok ? '战绩已复制到剪贴板 📋' : '复制失败，请手动选择文本');
      });
    });

    dom.scoreboard.addEventListener('click', function (event) {
      if (event.target === dom.scoreboard) closeScoreboard();
    });

    document.addEventListener('keydown', function (event) {
      var target = event.target || {};
      var tag = (target.tagName || '').toUpperCase();
      var inField = tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;

      if (event.key === 'Escape') {
        if (!dom.settingsModal.hidden) {
          closeSettings();
        } else if (!dom.scoreboard.hidden) {
          closeScoreboard();
        } else if (inField) {
          target.blur();
        } else {
          clearSelection();
        }
        return;
      }
      if (inField) return;
      if (event.key === 'Backspace') {
        event.preventDefault();
        undoOne();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        submitGuess();
      }
    });
  }

  /* ================= 启动 ================= */

  function init() {
    dom.board = $('board');
    dom.pool = $('pool');
    dom.records = $('records');
    dom.attemptCount = $('attemptCount');
    dom.timer = $('timer');
    dom.selCount = $('selCount');
    dom.sizeLabel = $('sizeLabel');
    dom.lockItem = $('lockItem');
    dom.lockCount = $('lockCount');
    dom.modeTip = $('modeTip');
    dom.poolHint = $('poolHint');
    dom.submitBtn = $('submitBtn');
    dom.undoBtn = $('undoBtn');
    dom.clearBtn = $('clearBtn');
    dom.sizeInput = $('sizeInput');
    dom.sizeMinus = $('sizeMinus');
    dom.sizePlus = $('sizePlus');
    dom.candInput = $('candInput');
    dom.candMinus = $('candMinus');
    dom.candPlus = $('candPlus');
    dom.candStepper = $('candStepper');
    dom.followToggle = $('followToggle');
    dom.dupToggle = $('dupToggle');
    dom.autoToggle = $('autoToggle');
    dom.difficultyChip = $('difficultyChip');
    dom.difficultyText = $('difficultyText');
    dom.settingsOpenBtn = $('settingsOpenBtn');
    dom.settingsModal = $('settingsModal');
    dom.settingsCancelBtn = $('settingsCancelBtn');
    dom.applySettingsBtn = $('applySettingsBtn');
    dom.settingsWarning = $('settingsWarning');
    dom.newGameBtn = $('newGameBtn');
    dom.clearRecordsBtn = $('clearRecordsBtn');
    dom.confetti = $('confetti');
    dom.scoreboard = $('scoreboard');
    dom.scoreMedal = $('scoreMedal');
    dom.scoreAnswer = $('scoreAnswer');
    dom.scoreAttempts = $('scoreAttempts');
    dom.scoreTime = $('scoreTime');
    dom.scoreDifficulty = $('scoreDifficulty');
    dom.scoreBest = $('scoreBest');
    dom.scoreHistory = $('scoreHistory');
    dom.copyResultBtn = $('copyResultBtn');
    dom.closeScoreBtn = $('closeScoreBtn');
    dom.playAgainBtn = $('playAgainBtn');
    dom.toast = $('toast');

    dom.sizeInput.min = String(Core.MIN_SIZE);
    dom.sizeInput.max = String(Core.MAX_SIZE);
    dom.candInput.max = String(Pool.chars.length);

    loadSettings();

    game = new Core.Game({
      pool: Pool.chars,
      size: state.size,
      candidateCount: state.candidateCount,
      allowDuplicates: state.allowDuplicates
    });

    bindEvents();
    rebuildPool();
    renderRecords();
    renderBoard();
    renderModeTip();
    updatePool();
    startTimer();
    syncSettingsUI();

    // 便于调试 / 自动化测试
    window.__emojiGuess = { game: game, state: state, core: Core };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
