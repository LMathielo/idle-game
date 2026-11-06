// Shared pieces of the recipe popover: craft time text, gear stat / rarity detail lines (all numbers from the engine's
// recipe view) and the stamina stepper. Dark popover palette (InfoPopover's box).
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GearRarityDetail, GearStats } from '../../engine';
import { colors, fonts } from '../../theme';
import { IconText } from '../art/Sprites';
import { formatClock } from '../format';
import { PERK_NAMES, RARITY_COLOR_NAMES } from '../items/itemInfo';
import { PixelButton } from '../PixelButton';
import { PopoverText } from '../ui/InfoPopover';

/** Craft time: one decimal under a minute (4.6s), m:ss above. */
export const formatCraftTime = (ms: number) => (ms < 60_000 ? `${(Math.ceil(ms / 100) / 10).toFixed(1)}s` : formatClock(ms));

/** "4–6 damage", "+3 armor": a gear recipe's stats at 100% quality. */
export function statText(st: GearStats): string {
  const out: string[] = [];
  if (st.damage) out.push(`${st.damage.min}–${st.damage.max} damage`);
  if (st.armor !== undefined) out.push(`+${st.armor} armor`);
  if (st.woodcuttingStrength !== undefined) out.push(`+${st.woodcuttingStrength} WS`);
  if (st.miningStrength !== undefined) out.push(`+${st.miningStrength} MS`);
  return out.join(', ');
}

/** "×1.25" / "×1" for a main-stat multiplier given in percent. */
const multiplierText = (pct: number) => `×${Number((pct / 100).toFixed(2))}`;

/** "max damage, max armor, HP regen or mana regen" / "max woodcutting strength". */
const perkKindsText = (kinds: GearRarityDetail['perk'] & object) => {
  const names = kinds.kinds.map((k) => PERK_NAMES[k]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names.join('');
};

/** The lines of one colour's details; every number comes from the engine (recipeView().gear.rarityDetails). */
function detailLines(d: GearRarityDetail): string[] {
  const lines = [
    `Chance: ${d.chancePct}%`,
    `Main stat, quality 0 to 100: ${statText(d.atQuality0)} to ${statText(d.atQuality100)} (${multiplierText(d.statPct)})`,
  ];
  if (!d.attributes) lines.push('Attribute bonuses: none');
  else if (d.attributes.count === 1) lines.push(`Attribute bonus: 1 random attribute, +${d.attributes.min} to +${d.attributes.max}`);
  else lines.push(`Attribute bonuses: ${d.attributes.count} different random attributes, +${d.attributes.min} to +${d.attributes.max} each`);
  if (d.perk) {
    lines.push(
      d.perk.kinds.length > 1
        ? `Perk: 1 random perk, +${d.perk.min}% to +${d.perk.max}%: ${perkKindsText(d.perk)}`
        : `Perk: +${d.perk.min}% to +${d.perk.max}% ${perkKindsText(d.perk)}`,
    );
  } else lines.push('Perk: none');
  return lines;
}

/** The Details body of a gear recipe: a Green | Blue | Purple toggle (default Green) and the chosen colour's lines. */
export function GearDetails({ details }: { details: GearRarityDetail[] }) {
  const [pick, setPick] = useState(0);
  const d = details[Math.min(pick, details.length - 1)];
  if (!d) return null;
  return (
    <View style={styles.rarityDetails}>
      <View style={styles.buttons}>
        {details.map((o, k) => (
          <PixelButton key={o.rarity} label={RARITY_COLOR_NAMES[o.rarity]} active={k === pick} onPress={() => setPick(k)} stretch />
        ))}
      </View>
      {detailLines(d).map((line) => (
        <PopoverText key={line}>{line}</PopoverText>
      ))}
    </View>
  );
}

const STAMINA_STEPS = [-10, -1, 1, 10] as const;

/** 0..max with −10 / −1 / +1 / +10 (hold to repeat; a repeat stops quietly at either end). */
export function StaminaStepper({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const current = useRef(value);
  current.current = value;
  const step = useCallback(
    (d: number) => () => {
      const next = Math.max(0, Math.min(max, current.current + d));
      if (next === current.current) return false;
      current.current = next;
      onChange(next);
      return true;
    },
    [max, onChange],
  );
  const actions = useMemo(() => STAMINA_STEPS.map((d) => step(d)), [step]);
  return (
    <View style={styles.stepper} accessible={false}>
      {STAMINA_STEPS.slice(0, 2).map((d, k) => (
        <PixelButton key={d} label={String(d).replace('-', '−')} repeat={actions[k]} disabled={value <= 0} accessibilityLabel={`${d} stamina`} />
      ))}
      <View style={styles.stepValueBox} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${value} stamina invested`}>
        <IconText icon="stamina" size={20} style={styles.stepValue}>
          {value}
        </IconText>
      </View>
      {STAMINA_STEPS.slice(2).map((d, k) => (
        <PixelButton key={d} label={`+${d}`} repeat={actions[k + 2]} disabled={value >= max} accessibilityLabel={`+${d} stamina`} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rarityDetails: { gap: 4 },
  buttons: { flexDirection: 'row', gap: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepValueBox: { flex: 1, alignItems: 'center' },
  stepValue: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.parchment },
});
