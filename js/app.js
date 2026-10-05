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
    var following = state.followSize;
    dom.sizeInput.value = String(game.size);
    dom.followToggle.checked = following;
    dom.candInput.value = String(game.candidateCount);
    dom.candInput.disabled = following;
    dom.candMinus.disabled = following;
    dom.candPlus.disabled = following;
    dom.candStepper.classList.toggle('is-locked', following);
    dom.dupToggle.checked = game.allowDuplicates;
    dom.autoToggle.checked = state.autoSubmit;
  }

  /* ================= 渲染：槽位 ================= */

  function renderBoard(popIndex) {
    var reveal = game.won;
    var values = reveal ? game.answer : game.selection;

    dom.board.innerHTML = '';

    for (var i = 0; i < game.size; i++) {
      var cell = document.createElement('div');
      cell.className = 'slot';
      cell.setAttribute('role', 'listitem');

      if (values[i]) {
        cell.classList.add('filled');
        cell.textContent = values[i];
        if (reveal) {
          cell.classList.add('solved', 'wave');
          cell.style.animationDelay = (i * 0.06).toFixed(2) + 's';
          cell.title = Pool.nameOf(values[i]);
        } else {
          cell.title = Pool.nameOf(values[i]) + '（点击移除）';
          cell.tabIndex = 0;
          cell.setAttribute('aria-label', '第 ' + (i + 1) + ' 位 ' + Pool.nameOf(values[i]) + '，按回车移除');
          (function (index) {
            var remove = function () { removeAt(index); };
            cell.addEventListener('click', remove);
            cell.addEventListener('keydown', function (event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                remove();
              }
            });
          })(i);
        }
        if (popIndex === i) cell.classList.add('pop');
      } else {
        cell.classList.add('empty');
        cell.textContent = String(i + 1);
      }
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
    dom.attemptCount.textContent = String(game.attempts);
    dom.timer.textContent = Core.formatDuration(elapsed);
    dom.selCount.textContent = String(game.selection.length);
    dom.sizeLabel.textContent = String(game.size);
    dom.submitBtn.disabled = game.won || !game.isFull();
    dom.undoBtn.disabled = game.won || game.selection.length === 0;
    dom.clearBtn.disabled = game.won || game.selection.length === 0;
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
      hint = '点一下加入，点格子里的可以移除';
    } else {
      hint = '选 ' + game.size + ' 个：点一下加入，点格子里的可以移除';
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
        toast('已经选满 ' + game.size + ' 个啦，先撤销或清空');
      } else if (result.reason === 'duplicate') {
        toast('当前是「不允许重复」模式，' + Pool.nameOf(char) + ' 已经选过了');
      } else {
        toast('本局已结束，点「新游戏」开下一局');
      }
      return;
    }

    restartAnimation(btn, 'tap');
    renderBoard(game.selection.length - 1);
    renderHud();
    updatePool();
    maybeAutoSubmit();
  }

  function removeAt(index) {
    cancelAutoSubmit();
    if (game.removeAt(index)) {
      renderBoard();
      renderHud();
      updatePool();
    }
  }

  function undoOne() {
    cancelAutoSubmit();
    if (game.undo()) {
      renderBoard();
      renderHud();
      updatePool();
    } else {
      toast('还没有可以撤销的 emoji');
    }
  }

  function clearSelection() {
    cancelAutoSubmit();
    if (game.clearSelection()) {
      renderBoard();
      renderHud();
      updatePool();
      toast('已清除全部已选 emoji');
    } else {
      toast('当前没有已选的 emoji');
    }
  }

  function maybeAutoSubmit() {
    cancelAutoSubmit();
    if (!state.autoSubmit || game.won || !game.isFull()) return;
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
      toast('还要再选 ' + (game.size - game.selection.length) + ' 个 emoji');
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
    } else if (record.exact === 0 && record.misplaced === 0) {
      flashBoard('shake-board');
      toast('一个都没沾上，换个思路 🤔');
    } else if (record.misplaced === 0 && record.exact > 0) {
      flashBoard('pulse-board');
      toast('位置全对的有 ' + record.exact + ' 个，继续缩小范围');
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
    document.body.classList.add('modal-open');
    dom.playAgainBtn.focus();
  }

  function closeScoreboard(immediate) {
    if (dom.scoreboard.hidden) return;
    document.body.classList.remove('modal-open');

    if (immediate || reducedMotion()) {
      dom.scoreboard.hidden = true;
      dom.scoreboard.classList.remove('closing');
      return;
    }

    dom.scoreboard.classList.add('closing');
    window.setTimeout(function () {
      dom.scoreboard.hidden = true;
      dom.scoreboard.classList.remove('closing');
    }, 190);
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
      toast('已按新难度开局：' + game.size + ' 位 · ' + game.candidateCount + ' 候选 · ' +
        (game.allowDuplicates ? '允许重复' : '不重复'));
    } else {
      syncSettingsUI();
      if (opts.toastMessage) toast(opts.toastMessage);
      maybeAutoSubmit();
    }
  }

  function stepNumber(input, delta) {
    input.value = String(Math.floor(Number(input.value) || 0) + delta);
    commitSettings();
  }

  /* ================= 事件绑定 ================= */

  function bindEvents() {
    dom.sizeInput.addEventListener('change', function () { commitSettings(); });
    dom.sizeInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitSettings();
        dom.sizeInput.blur();
      }
    });
    dom.sizeMinus.addEventListener('click', function () { stepNumber(dom.sizeInput, -1); });
    dom.sizePlus.addEventListener('click', function () { stepNumber(dom.sizeInput, 1); });

    dom.candInput.addEventListener('change', function () { commitSettings(); });
    dom.candInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitSettings();
        dom.candInput.blur();
      }
    });
    dom.candMinus.addEventListener('click', function () { stepNumber(dom.candInput, -1); });
    dom.candPlus.addEventListener('click', function () { stepNumber(dom.candInput, 1); });
    dom.followToggle.addEventListener('change', function () { commitSettings(); });

    dom.dupToggle.addEventListener('change', function () { commitSettings(); });
    dom.autoToggle.addEventListener('change', function () {
      commitSettings({
        toastMessage: dom.autoToggle.checked ? '已开启：选满自动判定' : '已关闭：需手动点「判定」'
      });
    });
    dom.applySizeBtn.addEventListener('click', function () {
      commitSettings({ force: true });
      toast('设置已应用：' + game.size + ' 位 · ' + game.candidateCount + ' 候选 · ' +
        (game.allowDuplicates ? '允许重复' : '不重复'));
    });
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
        if (!dom.scoreboard.hidden) {
          closeScoreboard();
        } else if (inField) {
          target.blur();
        } else {
          clearSelection();
        }
        return;
      }
      if (inField) {
        if (event.key === 'Enter' && (target === dom.sizeInput || target === dom.candInput)) {
          event.preventDefault();
          commitSettings();
          target.blur();
        }
        return;
      }
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
    dom.applySizeBtn = $('applySizeBtn');
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
