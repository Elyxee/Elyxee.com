const LETTERS = Object.freeze({ E: '.', L: '.-..', Y: '-.--', X: '-..-' });

// International Morse timing: dot 1, dash 3; within a letter 1, between
// letters 3, between repetitions 7. One ELYXEE cycle is exactly 58 units.
export function createMorseSignal(word = 'ELYXEE', unitSeconds = .085) {
  let cursor = 0;
  const pulses = [];
  [...word].forEach((letter, letterIndex) => {
    const code = LETTERS[letter];
    if (!code) throw new Error(`Unsupported Morse letter: ${letter}`);
    [...code].forEach((symbol, symbolIndex) => {
      const units = symbol === '.' ? 1 : 3;
      pulses.push({ letter, symbol, start: cursor, end: cursor + units });
      cursor += units + (symbolIndex === code.length - 1 ? 0 : 1);
    });
    cursor += letterIndex === word.length - 1 ? 7 : 3;
  });
  return {
    pulses,
    duration: cursor * unitSeconds,
    valueAt(seconds) {
      const time = ((seconds / unitSeconds) % cursor + cursor) % cursor;
      const pulse = pulses.find(p => time >= p.start && time < p.end);
      if (!pulse) return 0;
      // A 9 ms edge avoids a harsh digital cut without changing dot/dash timing.
      const fade = Math.min((time - pulse.start) / .11, (pulse.end - time) / .11, 1);
      return fade * fade * (3 - 2 * fade);
    },
  };
}
