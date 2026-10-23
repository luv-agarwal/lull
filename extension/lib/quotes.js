// Short lines for the block page. Questions that turn you back to what you were
// doing, and public-domain lines. No network: they ship with Lull.
export const QUOTES = [
  ['What were you about to do before this?'],
  ['What would you tell a friend who opened this tab right now?'],
  ['Is this a choice, or a reflex?'],
  ['The urge passes in a few minutes. You don\'t have to do anything with it.'],
  ['Notice the pull. Name it. Let it go by.'],
  ['What do you want to have done by tonight?'],
  ['Take one breath. Then pick the next small thing.'],
  ['You are allowed to be bored for a minute.'],
  ['If you are tired, rest. Scrolling is not rest.'],
  ['Which tab were you just in? Go back to it.'],
  ['Ten minutes from now, what will you be glad you did?'],
  ['Stand up, drink some water, come back.'],
  ['Nothing here will be different in an hour.'],
  ['The thing you are avoiding is probably smaller than it feels.'],
  ['Start with two minutes. Only two.'],
  ['You closed this door on purpose.'],
  ['Where is your attention going? Is that where you want it?'],
  ['Feel your feet on the floor. Now decide.'],
  ['Write down what you came here for. Look at it later.'],
  ['A quiet mind is a choice made many times a day.'],
  ['You have power over your mind, not outside events. Realize this, and you will find strength.', 'Marcus Aurelius'],
  ['Confine yourself to the present.', 'Marcus Aurelius'],
  ['Very little is needed to make a happy life.', 'Marcus Aurelius'],
  ['If it is not right, do not do it; if it is not true, do not say it.', 'Marcus Aurelius'],
  ['It is not that we have a short time to live, but that we waste a lot of it.', 'Seneca'],
  ['Begin at once to live.', 'Seneca'],
  ['While we wait for life, life passes.', 'Seneca'],
  ['Do every act of your life as though it were the very last.', 'Marcus Aurelius'],
  ['Our life is frittered away by detail. Simplify, simplify.', 'Henry David Thoreau'],
  ['It is not enough to be busy. The question is: what are we busy about?', 'Henry David Thoreau'],
  ['Nature does not hurry, yet everything is accomplished.', 'Lao Tzu'],
  ['The journey of a thousand miles begins with a single step.', 'Lao Tzu'],
  ['Well begun is half done.', 'Aristotle'],
  ['First say to yourself what you would be; then do what you have to do.', 'Epictetus'],
  ['The best time to plant a tree was twenty years ago. The second best time is now.', 'Proverb'],
  ['Little by little, one travels far.', 'Proverb'],
  ['Slow growing trees bear the best fruit.', 'Proverb'],
  ['Drop by drop, the pot is filled.', 'Proverb'],
  ['Where attention goes, energy flows.', 'Saying'],
  ['Ordinary days, done well, add up to a life.'],
];

// Pick a line, never the same as last time.
export function pickQuote(last = -1, rand = Math.random) {
  if (QUOTES.length < 2) return 0;
  let i = Math.floor(rand() * (QUOTES.length - 1));
  if (i >= last && last >= 0) i++;
  return i;
}
