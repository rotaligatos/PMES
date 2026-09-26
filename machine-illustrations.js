/* =====================================================================
   ModCraft PMES — machine illustrations (v3)
   Redrawn from real reference photos (image search, 2026-07-18), not
   guessed from memory. Key corrections from earlier drafts:
     - panel_saw: long flat sliding table with a blade rising through a
       slot along its length, NOT a boxy machine with a dial on top.
     - edgebander: long conveyor-style machine, board fed through one
       end with rollers along the top, board exits banded on the other.
     - boring_machine: horizontal panel with a dense grid of vertical
       drill spindles above it, not a single drill press.
   Flat vector style, layered shading for depth.
   ===================================================================== */

const MACHINE_ILLUSTRATIONS = {

  panel_saw: `
    <svg viewBox="0 0 280 160" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="140" cy="150" rx="120" ry="6" fill="#12233d" opacity="0.08"/>
      <rect x="18" y="120" width="244" height="8" rx="2" fill="#2c4258"/>
      <rect x="32" y="102" width="14" height="20" fill="#0c1a2e"/>
      <rect x="132" y="102" width="14" height="20" fill="#0c1a2e"/>
      <rect x="234" y="102" width="14" height="20" fill="#0c1a2e"/>

      <rect x="16" y="72" width="248" height="34" rx="4" fill="#e4ecf3" stroke="#3d5a80" stroke-width="2"/>
      <rect x="16" y="72" width="248" height="7" fill="#f4f7fa"/>

      <rect x="30" y="86" width="220" height="5" rx="2" fill="#b9c6d3"/>

      <g>
        <circle cx="190" cy="88" r="17" fill="#0c1a2e"/>
        <circle cx="190" cy="88" r="17" fill="none" stroke="#3d5a80" stroke-width="1.5"/>
        <g stroke="#5b6b7a" stroke-width="0.75">
          <line x1="190" y1="74" x2="190" y2="102"/>
          <line x1="176" y1="88" x2="204" y2="88"/>
          <line x1="180" y1="78" x2="200" y2="98"/>
          <line x1="200" y1="78" x2="180" y2="98"/>
        </g>
        <circle cx="190" cy="88" r="3.5" fill="#c97a2b"/>
      </g>

      <rect x="30" y="18" width="8" height="54" fill="#5b6b7a"/>
      <rect x="24" y="12" width="20" height="9" rx="2" fill="#12233d"/>

      <rect x="46" y="78" width="90" height="7" rx="2" fill="#c97a2b" opacity="0.85"/>
      <line x1="46" y1="88" x2="250" y2="88" stroke="#c97a2b" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>
    </svg>`,

  edgebander: `
    <svg viewBox="0 0 280 160" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="140" cy="150" rx="120" ry="6" fill="#12233d" opacity="0.08"/>
      <rect x="20" y="128" width="240" height="8" rx="2" fill="#2c4258"/>
      <rect x="36" y="112" width="12" height="18" fill="#0c1a2e"/>
      <rect x="232" y="112" width="12" height="18" fill="#0c1a2e"/>

      <rect x="18" y="60" width="244" height="52" rx="6" fill="#eef2f6" stroke="#3d5a80" stroke-width="2"/>
      <rect x="18" y="60" width="244" height="10" fill="#e4ecf3"/>

      <rect x="18" y="80" width="26" height="24" rx="2" fill="#c7d0d8"/>
      <path d="M44 82 l14 -4 v20 l-14 -4 z" fill="#5b6b7a"/>

      <g>
        <circle cx="90" cy="92" r="11" fill="#0c1a2e"/>
        <circle cx="90" cy="92" r="3.5" fill="#c97a2b"/>
      </g>
      <g>
        <circle cx="122" cy="92" r="11" fill="#0c1a2e"/>
        <circle cx="122" cy="92" r="3.5" fill="#c97a2b"/>
      </g>
      <g>
        <circle cx="154" cy="92" r="11" fill="#0c1a2e"/>
        <circle cx="154" cy="92" r="3.5" fill="#c97a2b"/>
      </g>
      <g>
        <circle cx="186" cy="92" r="11" fill="#0c1a2e"/>
        <circle cx="186" cy="92" r="3.5" fill="#c97a2b"/>
      </g>

      <path d="M212 84 l16 8 l-16 8 z" fill="#5b6b7a"/>
      <rect x="228" y="86" width="22" height="12" rx="2" fill="#c7d0d8"/>

      <line x1="44" y1="92" x2="228" y2="92" stroke="#c97a2b" stroke-width="1" stroke-dasharray="4,3" opacity="0.55"/>
    </svg>`,

  boring_machine: `
    <svg viewBox="0 0 280 160" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="140" cy="150" rx="120" ry="6" fill="#12233d" opacity="0.08"/>
      <rect x="24" y="128" width="232" height="8" rx="2" fill="#2c4258"/>
      <rect x="40" y="112" width="12" height="18" fill="#0c1a2e"/>
      <rect x="228" y="112" width="12" height="18" fill="#0c1a2e"/>

      <rect x="22" y="94" width="236" height="20" rx="3" fill="#d6dee6" stroke="#3d5a80" stroke-width="2"/>

      <rect x="40" y="34" width="200" height="14" rx="2" fill="#12233d"/>
      <g stroke="#3d5a80" stroke-width="2">
        <line x1="60" y1="48" x2="60" y2="92"/>
        <line x1="90" y1="48" x2="90" y2="92"/>
        <line x1="120" y1="48" x2="120" y2="92"/>
        <line x1="150" y1="48" x2="150" y2="92"/>
        <line x1="180" y1="48" x2="180" y2="92"/>
        <line x1="210" y1="48" x2="210" y2="92"/>
      </g>
      <g fill="#c97a2b">
        <circle cx="60" cy="92" r="3"/>
        <circle cx="90" cy="92" r="3"/>
        <circle cx="120" cy="92" r="3"/>
        <circle cx="150" cy="92" r="3"/>
        <circle cx="180" cy="92" r="3"/>
        <circle cx="210" cy="92" r="3"/>
      </g>
    </svg>`,

  drill_press: `
    <svg viewBox="0 0 200 170" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="100" cy="160" rx="65" ry="6" fill="#12233d" opacity="0.08"/>
      <rect x="60" y="140" width="80" height="16" rx="3" fill="#2c4258"/>
      <rect x="66" y="128" width="68" height="14" rx="2" fill="#d6dee6" stroke="#b9c6d3" stroke-width="1"/>
      <rect x="92" y="24" width="16" height="106" fill="#5b6b7a"/>
      <rect x="88" y="18" width="24" height="12" rx="2" fill="#5b6b7a"/>
      <rect x="55" y="18" width="90" height="20" rx="4" fill="#0c1a2e"/>
      <circle cx="145" cy="28" r="7" fill="#c97a2b"/>
      <rect x="70" y="66" width="60" height="14" rx="3" fill="#f4f7fa" stroke="#3d5a80" stroke-width="2"/>
      <rect x="93" y="80" width="14" height="34" fill="#3d5a80"/>
      <path d="M100 114 l-7 10 h14 z" fill="#c97a2b"/>
      <rect x="60" y="128" width="80" height="8" rx="2" fill="#eef2f6" stroke="#3d5a80" stroke-width="1.5"/>
      <rect x="70" y="34" width="6" height="18" fill="#12233d"/>
      <rect x="124" y="34" width="6" height="18" fill="#12233d"/>
    </svg>`,

  assembly_station: `
    <svg viewBox="0 0 240 160" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="120" cy="150" rx="100" ry="6" fill="#12233d" opacity="0.08"/>
      <rect x="26" y="98" width="188" height="12" rx="3" fill="#2c4258"/>
      <rect x="34" y="70" width="172" height="30" rx="4" fill="#f4f7fa" stroke="#3d5a80" stroke-width="2.5"/>
      <rect x="34" y="70" width="172" height="8" fill="#e4ecf3"/>
      <rect x="34" y="112" width="14" height="34" rx="2" fill="#2c4258"/>
      <rect x="192" y="112" width="14" height="34" rx="2" fill="#2c4258"/>
      <rect x="52" y="42" width="36" height="30" rx="3" fill="#d6dee6" stroke="#b9c6d3" stroke-width="1.5"/>
      <rect x="52" y="42" width="36" height="8" fill="#e9eff4"/>
      <rect x="98" y="48" width="26" height="24" rx="3" fill="#c97a2b" opacity="0.85"/>
      <circle cx="152" cy="58" r="13" fill="none" stroke="#12233d" stroke-width="2.5"/>
      <circle cx="152" cy="58" r="5" fill="#3d5a80"/>
      <rect x="176" y="46" width="18" height="26" rx="2" fill="#3d5a80" opacity="0.75"/>
      <line x1="44" y1="85" x2="196" y2="85" stroke="#b9c6d3" stroke-width="1" stroke-dasharray="2,4"/>
    </svg>`,

  press: `
    <svg viewBox="0 0 200 170" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="100" cy="160" rx="70" ry="6" fill="#12233d" opacity="0.08"/>
      <rect x="40" y="140" width="120" height="14" rx="3" fill="#2c4258"/>
      <rect x="48" y="24" width="14" height="118" fill="#5b6b7a"/>
      <rect x="138" y="24" width="14" height="118" fill="#5b6b7a"/>
      <rect x="38" y="16" width="124" height="18" rx="3" fill="#0c1a2e"/>
      <rect x="86" y="16" width="28" height="18" fill="#c97a2b"/>
      <rect x="58" y="66" width="84" height="20" rx="3" fill="#c97a2b"/>
      <rect x="58" y="66" width="84" height="6" fill="#e0954a"/>
      <rect x="58" y="94" width="84" height="16" rx="2" fill="#d6dee6" stroke="#b9c6d3" stroke-width="1.5"/>
      <rect x="70" y="50" width="60" height="8" rx="2" fill="#3d5a80" opacity="0.5"/>
    </svg>`,

  sander: `
    <svg viewBox="0 0 240 160" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="sandTexture" width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" fill="#8a97a3"/>
        </pattern>
      </defs>
      <ellipse cx="120" cy="150" rx="100" ry="6" fill="#12233d" opacity="0.08"/>
      <rect x="26" y="120" width="188" height="10" rx="3" fill="#2c4258"/>
      <rect x="36" y="60" width="168" height="60" rx="8" fill="#f4f7fa" stroke="#3d5a80" stroke-width="2.5"/>
      <rect x="36" y="60" width="168" height="14" rx="8" fill="#e4ecf3"/>
      <g>
        <circle cx="82" cy="94" r="22" fill="#d6dee6" stroke="#12233d" stroke-width="2.5"/>
        <circle cx="82" cy="94" r="22" fill="url(#sandTexture)" opacity="0.5"/>
        <circle cx="82" cy="94" r="6" fill="#3d5a80"/>
      </g>
      <g>
        <circle cx="158" cy="94" r="22" fill="#d6dee6" stroke="#12233d" stroke-width="2.5"/>
        <circle cx="158" cy="94" r="22" fill="url(#sandTexture)" opacity="0.5"/>
        <circle cx="158" cy="94" r="6" fill="#3d5a80"/>
      </g>
      <rect x="108" y="82" width="24" height="24" fill="#c97a2b" opacity="0.7"/>
      <rect x="42" y="132" width="14" height="22" rx="2" fill="#2c4258"/>
      <rect x="184" y="132" width="14" height="22" rx="2" fill="#2c4258"/>
    </svg>`,

  cnc_router: `
    <svg viewBox="0 0 240 160" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="120" cy="150" rx="100" ry="6" fill="#12233d" opacity="0.08"/>
      <rect x="24" y="132" width="192" height="10" rx="3" fill="#2c4258"/>
      <rect x="34" y="44" width="172" height="82" rx="6" fill="#f4f7fa" stroke="#3d5a80" stroke-width="2.5"/>
      <rect x="34" y="44" width="172" height="14" rx="6" fill="#e4ecf3"/>
      <rect x="48" y="96" width="144" height="18" rx="3" fill="#d6dee6" stroke="#b9c6d3" stroke-width="1"/>
      <line x1="52" y1="60" x2="188" y2="60" stroke="#0c1a2e" stroke-width="3"/>
      <rect x="52" y="55" width="10" height="10" fill="#5b6b7a"/>
      <rect x="178" y="55" width="10" height="10" fill="#5b6b7a"/>
      <rect x="115" y="58" width="12" height="42" fill="#12233d"/>
      <circle cx="121" cy="100" r="7" fill="#c97a2b"/>
      <path d="M60 74 q60 -10 120 0" stroke="#3d5a80" stroke-width="1" stroke-dasharray="3,3" fill="none" opacity="0.5"/>
      <rect x="38" y="144" width="14" height="16" rx="2" fill="#2c4258"/>
      <rect x="188" y="144" width="14" height="16" rx="2" fill="#2c4258"/>
    </svg>`,

  generic: `
    <svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="100" cy="140" rx="72" ry="6" fill="#12233d" opacity="0.08"/>
      <rect x="34" y="118" width="132" height="10" rx="3" fill="#2c4258"/>
      <rect x="50" y="46" width="100" height="60" rx="8" fill="#f4f7fa" stroke="#3d5a80" stroke-width="2.5"/>
      <rect x="50" y="46" width="100" height="14" rx="8" fill="#e4ecf3"/>
      <circle cx="100" cy="80" r="20" fill="#d6dee6" stroke="#12233d" stroke-width="2.5"/>
      <circle cx="100" cy="80" r="6" fill="#c97a2b"/>
      <rect x="58" y="128" width="12" height="18" rx="2" fill="#2c4258"/>
      <rect x="130" y="128" width="12" height="18" rx="2" fill="#2c4258"/>
    </svg>`,
};

function getMachineIllustration(machineType) {
  const ALIASES = { manual_edgebander: 'edgebander' };
  const key = ALIASES[machineType] || machineType;
  return MACHINE_ILLUSTRATIONS[key] || MACHINE_ILLUSTRATIONS.generic;
}

const MACHINE_TYPE_OPTIONS = [
  { value: 'panel_saw', label: 'Panel Saw' },
  { value: 'edgebander', label: 'Edgebanding Machine' },
  { value: 'manual_edgebander', label: 'Manual Edgebanding Machine' },
  { value: 'boring_machine', label: 'Boring Machine' },
  { value: 'drill_press', label: 'Drill Press' },
  { value: 'assembly_station', label: 'Assembly Station' },
  { value: 'press', label: 'Manual Lamination / Press' },
  { value: 'sander', label: 'Sander' },
  { value: 'cnc_router', label: 'CNC Router' },
  { value: 'generic', label: 'Other / generic' },
];
