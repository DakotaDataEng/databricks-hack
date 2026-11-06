import type { RankResponse } from '../api'
import { compact, int, pct } from '../format'

type Term = { term: string; value: string; meaning: string }

/**
 * Collapsed reference of everything the app treats as CNRL-specific: its identity, what is calibrated from its own
 * 2024–25 deals, and the client assumptions. Values are live, so they follow any edits on the Rank tab.
 */
export function CnrlTerms({ rank, operatorNames }: { rank: RankResponse | null; operatorNames: Map<string, string> }) {
  if (!rank) return null
  const a = rank.assumptions
  const b = rank.baseline
  const n = (k: string) => Number(a[k])
  const money = (k: string) => `$${int(n(k))}`
  const excluded = (Array.isArray(a.exclude_baids) ? a.exclude_baids : String(a.exclude_baids ?? '').split(','))
    .filter(Boolean).map(id => (operatorNames.get(id) ?? id).replace(/\s+(INC|LTD|CORP|LIMITED|ULC)\.?$/i, ''))

  const groups: { title: string; note: string; terms: Term[] }[] = [
    {
      title: 'Identity',
      note: 'How CNRL is found in Petrinex',
      terms: [
        { term: 'Operator BA ID', value: '0HE9', meaning: 'Every CNRL match keys on this ID, never the operator name (names persist on wells and facilities after a transfer).' },
        { term: 'CNRL footprint', value: 'cnrl_footprint', meaning: "Facilities whose latest reporting operator is 0HE9; 'acquired' if another BA ID reported the facility before CNRL's first month on it." },
        { term: 'Tie-in points', value: 'GP/GS gas · BT/IF liquids', meaning: 'Gas is routed to the nearest CNRL gas plant or gathering system, liquids to the nearest CNRL battery or injection facility.' },
      ],
    },
    {
      title: 'Calibrated from CNRL’s deals',
      note: `Size-weighted over the ${b.deals.length} deals ≥ ${int(n('material_deal_boe_d'))} boe/d (${b.deals.map(d => d.split(' ')[0]).join(', ')})`,
      terms: [
        { term: 'Deal size', value: `${compact(b.boe_d)} boe/d`, meaning: 'Pre-deal production (6-month window); the size anchor in precedent fit, compared on a log scale.' },
        { term: 'Gas share', value: pct(b.gas_share), meaning: 'Gas boe ÷ total boe of the deals; candidates are scored on absolute difference.' },
        { term: 'Distance to CNRL', value: `${b.median_km.toFixed(1)} km median · ${pct(b.share_within_25km)} ≤ 25 km`, meaning: 'Distance from acquired facilities to the nearest legacy CNRL facility; fit penalises the gap per 25 km.' },
        { term: 'Production retained', value: pct(b.retention, 1), meaning: 'Post-deal ÷ pre-deal production; applied to every candidate’s year-1 cash flow as integration loss.' },
        { term: 'Decline', value: `${pct(b.decline, 0)}/yr`, meaning: `Exponential fit on pre-deal months gave ${pct(b.raw_decline, 1)}/yr (growth), clamped to the ${pct(n('min_decline'), 0)}–${pct(n('max_decline'), 0)} range.` },
      ],
    },
    {
      title: 'Client assumptions',
      note: 'Defaults; editable on the Rank tab',
      terms: [
        { term: 'Discount rate · ROCE hurdle', value: `${pct(n('discount_rate'))} · ${pct(n('roce_hurdle'))}`, meaning: `NPV over ${int(n('npv_years'))} years at the discount rate; accretive = NPV − price > 0 and year-1 ROCE > hurdle.` },
        { term: 'Price per flowing boe/d', value: a.price_basis === 'mix' ? `${money('price_per_flowing_boe_gas')} gas · ${money('price_per_flowing_boe_liquids')} liquids` : money('price_per_flowing_boe'), meaning: `Acquisition price = boe/d × multiple; sensitivity at ${money('price_per_flowing_boe_low')} / ${money('price_per_flowing_boe_high')}.` },
        { term: 'Royalty · tax', value: `${pct(n('royalty_rate'))} · ${pct(n('tax_rate'))}`, meaning: 'Flat royalty on revenue (Petrinex royalty rows are oil-in-kind only); corporate tax on operating cash flow and synergies.' },
        { term: 'Opex', value: `$${n('opex_gas_per_boe')} / $${n('opex_light_per_boe')} / $${n('opex_heavy_per_boe')} per boe`, meaning: 'Gas / light oil & liquids / heavy & thermal.' },
        { term: 'Transport tariffs', value: `$${n('liq_tariff_per_m3_km')}/m³·km · $${n('gas_tariff_per_e3m3_km')}/e³m³·km`, meaning: 'Synergy = (current haul − haul to CNRL tie-in) × 2025 volume × tariff, after tax. Gas tariff is a placeholder.' },
        { term: 'Candidate universe', value: `≥ ${int(n('min_candidate_boe_d'))} boe/d`, meaning: `Non-CNRL producers above the floor, excluding ${excluded.join(', ')}.` },
        { term: 'Score weights', value: `${pct(n('weight_accretion'))} / ${pct(n('weight_proximity'))} / ${pct(n('weight_precedent_fit'))}`, meaning: 'Value created / proximity (production within 10, 25, 50 km of CNRL) / fit with the deal profile above.' },
      ],
    },
  ]

  return (
    <details className="cnrl-terms">
      <summary>CNRL-specific terms and values</summary>
      <div className="cnrl-groups">
        {groups.map(g => (
          <section key={g.title}>
            <h4>{g.title}</h4>
            <p className="muted small-text">{g.note}</p>
            <dl>
              {g.terms.map(t => (
                <div key={t.term}>
                  <dt>{t.term}</dt>
                  <dd className="val">{t.value}</dd>
                  <dd className="meaning">{t.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </details>
  )
}
