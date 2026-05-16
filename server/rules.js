const INITIAL_COINS = 1000;
const MAX_COINS = 100000000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 12;
const DOUBLE_DECK_THRESHOLD = 8;
const DEFAULT_ACTION_TIMEOUT_SECONDS = 180;
const MIN_ACTION_TIMEOUT_SECONDS = 10;
const MAX_ACTION_TIMEOUT_SECONDS = 3600;

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['S', 'H', 'D', 'C'];
const RANK_VALUE = RANKS.reduce((map, rank, index) => {
  map[rank] = index + 2;
  return map;
}, {});

const HAND_LABELS = {
  high_card: '普通牌',
  pair: '对子',
  flush: '同花',
  tractor: '拖拉机',
  straight_flush: '同花顺',
  triple: '豹子',
};

const MODE_RANKS = {
  zha_jing_hua: {
    high_card: 1,
    pair: 2,
    tractor: 3,
    flush: 4,
    straight_flush: 5,
    triple: 6,
  },
  tractor: {
    high_card: 1,
    pair: 2,
    flush: 3,
    straight_flush: 4,
    tractor: 5,
    triple: 6,
  },
};

function normalizeConfig(input = {}) {
  const maxPlayers = clampInt(input.maxPlayers ?? input.playerCount ?? 6, MIN_PLAYERS, MAX_PLAYERS);
  const normalizedBetOptions = Array.isArray(input.betOptions)
    ? input.betOptions
      .map((value) => Math.floor(Number(value)))
      .filter((value) => Number.isFinite(value) && value >= 1)
      .map((value) => clampInt(value, 1, MAX_COINS))
    : [];
  const betOptions = normalizedBetOptions.length ? normalizedBetOptions : [5, 10, 20, 50];

  return {
    mode: MODE_RANKS[input.mode] ? input.mode : 'zha_jing_hua',
    maxPlayers,
    initialCoins: clampInt(input.initialCoins ?? INITIAL_COINS, 1, MAX_COINS),
    baseBet: clampInt(input.baseBet ?? 5, 1, MAX_COINS),
    bonus: clampInt(input.bonus ?? 50, 0, MAX_COINS),
    peekCost: clampInt(input.peekCost ?? 10, 0, MAX_COINS),
    actionTimeoutSeconds: clampInt(
      input.actionTimeoutSeconds ?? DEFAULT_ACTION_TIMEOUT_SECONDS,
      MIN_ACTION_TIMEOUT_SECONDS,
      MAX_ACTION_TIMEOUT_SECONDS
    ),
    betOptions: [...new Set(betOptions)].sort((a, b) => a - b),
  };
}

function clampInt(value, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function getDeckCount(playerCount) {
  return playerCount > DOUBLE_DECK_THRESHOLD ? 2 : 1;
}

function createDeck(playerCount) {
  const deckCount = getDeckCount(playerCount);
  const cards = [];

  for (let deck = 1; deck <= deckCount; deck++) {
    SUITS.forEach((suit) => {
      RANKS.forEach((rank) => {
        cards.push({
          id: `${deck}-${suit}-${rank}`,
          deck,
          suit,
          rank,
          value: RANK_VALUE[rank],
        });
      });
    });
  }

  return cards;
}

function shuffle(cards, random = Math.random) {
  const result = cards.slice();

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function dealHands(playerIds, random = Math.random) {
  const deck = shuffle(createDeck(playerIds.length), random);
  const hands = {};

  playerIds.forEach((playerId, index) => {
    hands[playerId] = deck.slice(index * 3, index * 3 + 3);
  });

  return hands;
}

function evaluateHand(cards, mode = 'zha_jing_hua') {
  if (!Array.isArray(cards) || cards.length !== 3) {
    throw new Error('A hand must contain exactly three cards.');
  }

  const values = cards.map((card) => card.value).sort((a, b) => b - a);
  const ascending = values.slice().sort((a, b) => a - b);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const counts = values.reduce((map, value) => {
    map[value] = (map[value] || 0) + 1;
    return map;
  }, {});
  const groups = Object.keys(counts).map(Number).sort((a, b) => {
    const countDiff = counts[b] - counts[a];
    return countDiff || b - a;
  });
  const wheelStraight = ascending[0] === 2 && ascending[1] === 3 && ascending[2] === 14;
  const naturalStraight = ascending[0] + 1 === ascending[1] && ascending[1] + 1 === ascending[2];
  const straight = wheelStraight || naturalStraight;
  const straightHigh = wheelStraight ? 3 : ascending[2];

  let type = 'high_card';
  let tiebreakers = values;

  if (groups.length === 1) {
    type = 'triple';
    tiebreakers = [groups[0]];
  } else if (straight && flush) {
    type = 'straight_flush';
    tiebreakers = [straightHigh];
  } else if (straight) {
    type = 'tractor';
    tiebreakers = [straightHigh];
  } else if (flush) {
    type = 'flush';
    tiebreakers = values;
  } else if (groups.length === 2) {
    const pairValue = groups.find((value) => counts[value] === 2);
    const kicker = groups.find((value) => counts[value] === 1);
    type = 'pair';
    tiebreakers = [pairValue, kicker];
  }

  return {
    type,
    label: HAND_LABELS[type],
    rank: MODE_RANKS[mode]?.[type] || MODE_RANKS.zha_jing_hua[type],
    tiebreakers,
    cards,
  };
}

function compareHands(leftCards, rightCards, mode = 'zha_jing_hua') {
  const left = isHandEvaluation(leftCards) ? leftCards : evaluateHand(leftCards, mode);
  const right = isHandEvaluation(rightCards) ? rightCards : evaluateHand(rightCards, mode);

  if (left.rank !== right.rank) {
    return left.rank > right.rank ? 1 : -1;
  }

  const length = Math.max(left.tiebreakers.length, right.tiebreakers.length);
  for (let i = 0; i < length; i++) {
    const leftValue = left.tiebreakers[i] || 0;
    const rightValue = right.tiebreakers[i] || 0;
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1;
  }

  return 0;
}

function isHandEvaluation(value) {
  return Boolean(
    value
      && typeof value.type === 'string'
      && typeof value.rank === 'number'
      && Array.isArray(value.tiebreakers)
  );
}

function findWinningPlayerIds(playerIds, hands, mode) {
  let winners = [];
  let bestEvaluation = null;

  playerIds.forEach((playerId) => {
    const evaluation = evaluateHand(hands[playerId], mode);
    if (!bestEvaluation) {
      winners = [playerId];
      bestEvaluation = evaluation;
      return;
    }

    const result = compareHands(evaluation, bestEvaluation, mode);
    if (result > 0) {
      winners = [playerId];
      bestEvaluation = evaluation;
    } else if (result === 0) {
      winners.push(playerId);
    }
  });

  return winners;
}

function publicCard(card) {
  return { suit: card.suit, rank: card.rank, value: card.value };
}

function handSummary(cards, mode) {
  const evaluation = evaluateHand(cards, mode);
  return {
    type: evaluation.type,
    label: evaluation.label,
    rank: evaluation.rank,
    tiebreakers: evaluation.tiebreakers,
    cards: cards.map(publicCard),
  };
}

module.exports = {
  DOUBLE_DECK_THRESHOLD,
  DEFAULT_ACTION_TIMEOUT_SECONDS,
  HAND_LABELS,
  INITIAL_COINS,
  MAX_ACTION_TIMEOUT_SECONDS,
  MAX_COINS,
  MAX_PLAYERS,
  MIN_ACTION_TIMEOUT_SECONDS,
  MIN_PLAYERS,
  MODE_RANKS,
  RANKS,
  RANK_VALUE,
  SUITS,
  compareHands,
  createDeck,
  dealHands,
  evaluateHand,
  findWinningPlayerIds,
  getDeckCount,
  handSummary,
  normalizeConfig,
  publicCard,
  shuffle,
};
