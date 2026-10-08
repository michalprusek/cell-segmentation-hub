import { describe, it, expect } from 'vitest';
import en from '../en';
import cs from '../cs';
import es from '../es';
import de from '../de';
import fr from '../fr';
import zh from '../zh';

// `LanguageContext` has no plural handling: a string is one template and
// `{{count}}` is substituted as-is. A count that can be 1 therefore must not
// sit next to a noun that has to agree with it.
//
// The bulk-propagate toast used to be given the number of microtubules SENT —
// at least 2, because the menu item needs a multi-selection — and its strings
// were plural-only. It now counts the microtubules that CHANGED, and the
// feature's main case is 1 (select five, edit one, propagate): "Propagated 1
// microtubules to the following frames", "1 mikrotubulů propagováno do
// dalších snímků". These strings state the number after a label instead,
// which reads correctly for every count in every one of the six languages.
const locales = { en, cs, es, de, fr, zh } as const;

const at = (tree: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      tree
    );

/** Keys whose `{{count}}` can be 1 and whose noun would have to inflect. */
const COUNT_NEUTRAL_KEYS = ['segmentation.trackOps.propagateSelectedSuccess'];

describe('strings whose count can be 1 do not attach it to a noun', () => {
  describe.each(COUNT_NEUTRAL_KEYS)('%s', key => {
    it.each(Object.entries(locales))('%s', (_code, tree) => {
      const template = at(tree, key);
      expect(typeof template).toBe('string');
      const text = template as string;
      // Exactly one placeholder, and it closes the sentence: nothing after
      // it can disagree with it. A leading or mid-sentence count ("{{count}}
      // microtubules …", "… {{count}} 个微管 …") is the shape that broke.
      expect(text.match(/\{\{count\}\}/g)).toHaveLength(1);
      expect(text).toMatch(/[:：]\s?\{\{count\}\}$/u);
    });
  });
});
