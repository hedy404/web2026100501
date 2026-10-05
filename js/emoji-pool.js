/**
 * 候选 emoji 池。
 * 只使用单个 Unicode 码位的常见 emoji，避免肤色修饰符 / ZWJ 组合在
 * 不同平台上被拆成多个字符，从而保证「一个格子 = 一个 emoji」。
 */
(function (global) {
  'use strict';

  var EMOJI_POOL = [
    { char: '\u{1F34E}', name: '红苹果' },
    { char: '\u{1F34C}', name: '香蕉' },
    { char: '\u{1F347}', name: '葡萄' },
    { char: '\u{1F353}', name: '草莓' },
    { char: '\u{1F349}', name: '西瓜' },
    { char: '\u{1F352}', name: '樱桃' },
    { char: '\u{1F955}', name: '胡萝卜' },
    { char: '\u{1F344}', name: '蘑菇' },
    { char: '\u{1F338}', name: '樱花' },
    { char: '\u{1F33B}', name: '向日葵' },
    { char: '\u{1F335}', name: '仙人掌' },
    { char: '\u{1F340}', name: '四叶草' },
    { char: '\u{1F436}', name: '小狗' },
    { char: '\u{1F431}', name: '小猫' },
    { char: '\u{1F43C}', name: '熊猫' },
    { char: '\u{1F98A}', name: '狐狸' },
    { char: '\u{1F438}', name: '青蛙' },
    { char: '\u{1F427}', name: '企鹅' },
    { char: '\u{1F984}', name: '独角兽' },
    { char: '\u{1F41D}', name: '蜜蜂' },
    { char: '\u{2B50}', name: '星星' },
    { char: '\u{1F319}', name: '月亮' },
    { char: '\u{1F525}', name: '火焰' },
    { char: '\u{1F388}', name: '气球' }
  ];

  global.EmojiPool = {
    list: EMOJI_POOL,
    chars: EMOJI_POOL.map(function (item) { return item.char; }),
    nameOf: function (char) {
      for (var i = 0; i < EMOJI_POOL.length; i++) {
        if (EMOJI_POOL[i].char === char) return EMOJI_POOL[i].name;
      }
      return char;
    }
  };
})(window);
