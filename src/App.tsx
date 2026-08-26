import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type UnitType = 'Patrol' | 'SWAT' | 'Investigator'

type CaseCoords = {
  left: string
  top: string
}

type ClueCard = {
  id: number
  label: string
  description: string
}

type ClueLink = {
  cardIds: [number, number]
  result: string
}

type InterrogationScenario = {
  prompt: string
  options: string[]
  correctIndex: number
}

type CasePhoto = {
  id: number
  label: string
  filename: string
  description: string
  archiveRef: string
  found: boolean
}

type GameCase = {
  id: number
  title: string
  alias: string
  crime: string
  status: 'Aktiv' | 'Ungeklärt' | 'Festgenommen'
  danger: string
  progress: number
  summary: string
  evidence: string[]
  hint: string
  coords: CaseCoords
  risk: number
  onSite: boolean
  actionA: boolean
  captured: boolean
  swatChance: number
  boardTime: number
  boardSolved: boolean
  boardFailed: boolean
  boardCards: ClueCard[]
  boardLinks: ClueLink[]
  boardResult?: string
  interrogation: InterrogationScenario
  interrogationSolved: boolean
  interrogationAborted: boolean
  audioTargetFreq: number
  audioTargetNoise: number
  audioSolved: boolean
  audioClue: ClueCard
  photos: CasePhoto[]
  storyIntro: string
  storyObjectives: string[]
  storyStage: number
}

type Unit = {
  id: number
  type: UnitType
  label: string
  status: 'idle' | 'traveling' | 'onsite'
  assignedCaseId: number | null
  coords: CaseCoords
}

type TabKey = 'map' | 'board' | 'audio'

type StoryChoice = {
  id: number
  title: string
  description: string
  progressDelta: number
  riskDelta: number
  result: string
  addCard?: ClueCard
}

type StoryStage = {
  title: string
  description: string
  choices: StoryChoice[]
}

const HQ: CaseCoords = { left: '28%', top: '88%' }

const AUDIO_PATHS: Record<'caseStart' | 'arrival' | 'arrest' | 'audioSolved', string> = {
  caseStart: 'audio/case-start.mp3',
  arrival: 'audio/arrival.mp3',
  arrest: 'audio/arrest.mp3',
  audioSolved: 'audio/audio-solved.mp3'
}

const DESKTOP_APPS = [
  { id: 'cctv', label: 'CCTV', icon: '📺', tab: 'map' as TabKey },
  { id: 'case', label: 'Fallakte', icon: '🗂️', tab: 'board' as TabKey },
  { id: 'evidence', label: 'Beweise', icon: '🧩', tab: 'board' as TabKey },
  { id: 'audio', label: 'Audio-Labor', icon: '🎧', tab: 'audio' as TabKey }
]

const MAP_POSITIONS: CaseCoords[] = [
  { left: '72%', top: '18%' },
  { left: '82%', top: '60%' },
  { left: '48%', top: '28%' },
  { left: '30%', top: '72%' },
  { left: '64%', top: '46%' }
]

const CASE_STORY_STAGES: Record<number, StoryStage[]> = {
  1: [
    {
      title: 'Erster Tatortbericht',
      description: 'Der Täter hinterließ ein Ritualsymbol. Entscheide zuerst, welche Spur du zuerst priorisierst.',
      choices: [
        {
          id: 1,
          title: 'Tatort sichern',
          description: 'SWAT zuerst zum Schutz, damit Beweise ungestört bleiben.',
          progressDelta: 10,
          riskDelta: -8,
          result: 'SWAT sichert den Tatort. Die Ermittlungen können konzentriert weitergeführt werden.',
        },
        {
          id: 2,
          title: 'Zeugen befragen',
          description: 'Später mehr Infos vom Nachbarn, aber das Risiko bleibt höher.',
          progressDelta: 5,
          riskDelta: 10,
          result: 'Die Befragung liefert Hinweise, aber der Tatort ist anfälliger geworden.',
        }
      ]
    },
    {
      title: 'Analyse der ersten Spuren',
      description: 'Wähle eine Untersuchung, die dir den entscheidenden Hinweis liefern könnte.',
      choices: [
        {
          id: 3,
          title: 'Blutspur analysieren',
          description: 'Der Täter hat hinter der Spiegelzeichnung etwas versteckt.',
          progressDelta: 12,
          riskDelta: -5,
          result: 'Die Blutspur führt zu einem wichtigen Motiv. Deine Ermittlungen kommen voran.',
        },
        {
          id: 4,
          title: 'Tatortvideo prüfen',
          description: 'Vielleicht gibt es einen Blickwinkel, den niemand bedacht hat.',
          progressDelta: 8,
          riskDelta: 0,
          result: 'Das Video zeigt nur verschwommenen Verkehr. Die Suche muss weitergehen.',
        }
      ]
    }
  ],
  2: [
    {
      title: 'Ermittlungsdruck steigen lassen',
      description: 'Die Nebel-Serie schreit nach sofortiger Analyse.',
      choices: [
        {
          id: 5,
          title: 'Codierte Botschaft entschlüsseln',
          description: 'Entschlüssele die Nachricht und finde den nächsten Anschlagsort.',
          progressDelta: 15,
          riskDelta: -10,
          result: 'Der Code gibt ein klares Ziel preis. Der Fall gewinnt an Struktur.',
        },
        {
          id: 6,
          title: 'Opferposter vergleichen',
          description: 'Untersuche wiederkehrende Muster in den Bildern.',
          progressDelta: 7,
          riskDelta: 5,
          result: 'Die Muster bleiben kryptisch. Der Täter spielt mit der Zeit.',
        }
      ]
    },
    {
      title: 'Präzision versus Eile',
      description: 'Setze die Ressourcen für einen endgültigen Hinweis ein.',
      choices: [
        {
          id: 7,
          title: 'Videoanalyse priorisieren',
          description: 'Ein schneller Blick auf Überwachungsmaterial kann den Druck mindern.',
          progressDelta: 10,
          riskDelta: 0,
          result: 'Das Video bestätigt den Verdacht und reduziert die Ungewissheit.',
        },
        {
          id: 8,
          title: 'Zeugen erneut befragen',
          description: 'Mehr Aussagen können aber auch verwirren.',
          progressDelta: 4,
          riskDelta: 5,
          result: 'Die Aussagen widersprechen sich. Der Fall wird dunkler.',
        }
      ]
    }
  ],
  3: [
    {
      title: 'Psychospiel des Täters',
      description: 'Setze dein Team so ein, dass du den nächsten Schritt des Täters antizipierst.',
      choices: [
        {
          id: 9,
          title: 'Täterpsychologie auswerten',
          description: 'Nutze die Profildaten, um seine typische Vorgehensweise zu erkennen.',
          progressDelta: 12,
          riskDelta: -7,
          result: 'Das Profil zeigt eine klare Spur. Du gewinnst die Oberhand.',
        },
        {
          id: 10,
          title: 'Tatort sichern und abwarten',
          description: 'Mehr Sicherheit kostet Zeit, aber reduziert die Gefahr.',
          progressDelta: 7,
          riskDelta: -12,
          result: 'Die Lage beruhigt sich. Der Täter hat weniger Chancen, Spuren zu verwischen.',
        }
      ]
    },
    {
      title: 'Letzte Untersuchung vor dem Verhör',
      description: 'Triff die letzte taktische Entscheidung vor der Vernehmung.',
      choices: [
        {
          id: 11,
          title: 'Beweismaterial reorganisieren',
          description: 'Ordne die Hinweise neu, um die beste Frage zu finden.',
          progressDelta: 10,
          riskDelta: 0,
          result: 'Die Beweise führen zu einer starken Verhörstrategie.',
        },
        {
          id: 12,
          title: 'Direkt ins Verhör gehen',
          description: 'Ein frühes Verhör kann den Täter überraschen.',
          progressDelta: 5,
          riskDelta: 10,
          result: 'Der Verdächtige ist misstrauisch, aber das Verhör beginnt früher.',
        }
      ]
    }
  ]
}

// Simple road network nodes (percent-based coordinates on the 1000x1000 map)
type RoadNode = {
  id: number
  coords: CaseCoords
  neighbors: number[]
}

const ROAD_NODES: RoadNode[] = [
  { id: 1, coords: { left: '20%', top: '88%' }, neighbors: [2, 4] }, // HQ area
  { id: 2, coords: { left: '28%', top: '72%' }, neighbors: [1, 3] },
  { id: 3, coords: { left: '40%', top: '56%' }, neighbors: [2, 5] },
  { id: 4, coords: { left: '12%', top: '60%' }, neighbors: [1, 6] },
  { id: 5, coords: { left: '60%', top: '48%' }, neighbors: [3, 7] },
  { id: 6, coords: { left: '8%', top: '36%' }, neighbors: [4] },
  { id: 7, coords: { left: '72%', top: '18%' }, neighbors: [5, 8] },
  { id: 8, coords: { left: '82%', top: '60%' }, neighbors: [7] }
]

function nodeById(id: number) {
  return ROAD_NODES.find((n) => n.id === id) as RoadNode
}

function distCoords(a: CaseCoords, b: CaseCoords) {
  const ax = percentValue(a.left)
  const ay = percentValue(a.top)
  const bx = percentValue(b.left)
  const by = percentValue(b.top)
  return Math.hypot(bx - ax, by - ay)
}

function findNearestNodeId(coord: CaseCoords) {
  let best = ROAD_NODES[0].id
  let bestD = Infinity
  for (const n of ROAD_NODES) {
    const d = distCoords(n.coords, coord)
    if (d < bestD) {
      bestD = d
      best = n.id
    }
  }
  return best
}

function findPathNodeIds(startId: number, targetId: number) {
  // simple BFS path (graph is small)
  const q: number[] = [startId]
  const prev = new Map<number, number | null>()
  prev.set(startId, null)
  while (q.length) {
    const cur = q.shift() as number
    if (cur === targetId) break
    const node = nodeById(cur)
    for (const nb of node.neighbors) {
      if (!prev.has(nb)) {
        prev.set(nb, cur)
        q.push(nb)
      }
    }
  }
  if (!prev.has(targetId)) return []
  const path: number[] = []
  let cur: number | null = targetId
  while (cur !== null) {
    path.push(cur)
    cur = prev.get(cur) ?? null
  }
  return path.reverse()
}


const initialCases: GameCase[] = [
  {
    id: 1,
    title: 'Der lächelnde Beobachter',
    alias: 'The Smiling Observer',
    crime: 'Blutiger Kunstgriff am Badezimmerspiegel',
    status: 'Aktiv',
    danger: 'Extreme Gefahr',
    progress: 15,
    summary:
      'Ein Opfer wurde in seiner Wohnung gefunden. Seltsam: Alle Uhren im Haus wurden exakt auf 03:14 Uhr vorgestellt und der Täter hat ein lächelndes Gesicht mit dem Blut des Opfers an den Badezimmerspiegel gemalt.',
    evidence: ['Blutige Spiegelzeichnung', 'Uhren, die alle auf 03:14 Uhr gestellt wurden', 'Kratzspur am Türrahmen der Wohnung'],
    hint: 'Untersuche das Badezimmer und sprich mit Nachbarn – der Täter ist ritualisiert und beobachtet jede Reaktion.',
    coords: MAP_POSITIONS[0],
    risk: 12,
    onSite: false,
    actionA: false,
    captured: false,
    swatChance: 40,
    boardTime: 60,
    boardSolved: false,
    boardFailed: false,
    boardCards: [
      { id: 1, label: 'Blutiges Lächeln', description: 'Das Motiv ist in der Spiegelzeichnung verborgen.' },
      { id: 2, label: 'Psychiatrie-Akte', description: 'Ein früherer Patient wurde wegen Selbstgesprächen behandelt.' },
      { id: 3, label: 'Zeugenaussage', description: 'Ein Nachbar sah einen Mann in einem schwarzen Mantel.' }
    ],
    boardLinks: [
      { cardIds: [1, 2], result: 'Mega-Hinweis: Der Täter war Patient und nutzte seine Psychiatrie-Geschichte als Identität.' },
      { cardIds: [1, 3], result: 'Der Täter inszenierte das blutige Lächeln als Zeichen eines Rituals.' }
    ],
    boardResult: undefined,
    interrogation: {
      prompt: 'Verdächtiger: „Ich war die ganze Nacht zu Hause und habe geschlafen!“',
      options: [
        'Lüge! Wir haben Ihre Fingerabdrücke auf der Uhr am Tatort gefunden!',
        'Ihr Alibi klingt glaubwürdig. Wir prüfen noch Spuren.',
        'Vielleicht haben Sie den Schlüssel irgendwo verloren?'
      ],
      correctIndex: 0
    },
    interrogationSolved: false,
    interrogationAborted: false,
    audioTargetFreq: 75,
    audioTargetNoise: 20,
    audioSolved: false,
    audioClue: { id: 4, label: 'Kirchenhintergrund', description: 'Ein Glockenschlag im Audio führt zur Kirche als wichtigem Hinweis.' },
    photos: [
      {
        id: 1,
        label: 'Wohnzimmeraufnahme',
        filename: 'photo-01-livingroom.webp',
        description: 'Innenaufnahme des Tatorts mit zerwühltem Tisch und umgekippten Möbeln.',
        archiveRef: 'AKT-1902-01',
        found: false
      },
      {
        id: 2,
        label: 'Opfer im Bett',
        filename: 'photo-02-victime-bed.jpg',
        description: 'Die Leiche liegt auf einem Bett, aufgenommen aus der Vogelperspektive.',
        archiveRef: 'AKT-1902-02',
        found: false
      },
      {
        id: 3,
        label: 'Leiche am Boden',
        filename: 'photo-04-body-floor.jpg',
        description: 'Der Tatort zeigt den Körper neben dem Tisch und verstreute Beweisstücke.',
        archiveRef: 'AKT-1902-03',
        found: false
      }
    ],
    storyIntro: 'Ein erstklassiges Team wurde zum Tatort beordert. Du musst entscheiden, ob du den Tatort zuerst sicherst oder die Zeugen befragst.',
    storyObjectives: ['Tatort sichern', 'Zeugen befragen', 'Wichtige Hinweise finden'],
    storyStage: 0
  },
  {
    id: 2,
    title: 'Die Nebel-Serie',
    alias: 'Der Aschenmarkt',
    crime: 'Serienmorde mit kodierten Opferpostern',
    status: 'Ungeklärt',
    danger: 'Hohe Gefahr',
    progress: 42,
    summary:
      'Eine Folge von Entführungen und ritualisierten Aufrufen, die den Ermittlern eine verzerrte Weltanschauung zeigt. Der Täter dehnt die Zeit und fordert taktische Entscheidungen von deinen Teams.',
    evidence: ['Kodierte Nachricht auf einem alten Zeitungsausschnitt', 'Überwachungsbild mit verwischter Bewegung', 'Notizbuchseite mit numerischer Sequenz'],
    hint: 'Nicht jede Spur führt zum Opfer – manche sind ein Psychospiel des Täters.',
    coords: MAP_POSITIONS[1],
    risk: 25,
    onSite: false,
    actionA: false,
    captured: false,
    swatChance: 40,
    boardTime: 120,
    boardSolved: false,
    boardFailed: false,
    boardCards: [
      { id: 5, label: 'Poster mit Rauch', description: 'Die Opferposter zeigen verrauschte Symbole.' },
      { id: 6, label: 'Codierte Botschaft', description: 'Der Täter nutzt Zahlen als versteckte Signale.' },
      { id: 7, label: 'Überwachungsvideo', description: 'Ein Schattenmoment zeigt einen schnellen Fremden.' }
    ],
    boardLinks: [
      { cardIds: [5, 6], result: 'Mega-Hinweis: Der Täter nutzt die Asche als Kommunikationscode.' }
    ],
    boardResult: undefined,
    interrogation: {
      prompt: 'Verdächtiger: „Ich habe nichts mit diesen Postern zu tun.“',
      options: ['Sie haben die Zeichen am Tatort hinterlassen.', 'Sie waren zur Tatzeit nicht in der Stadt.', 'Die Opfer kannten Sie nicht.'],
      correctIndex: 0
    },
    interrogationSolved: false,
    interrogationAborted: false,
    audioTargetFreq: 62,
    audioTargetNoise: 30,
    audioSolved: false,
    audioClue: { id: 8, label: 'Flugzeugstart', description: 'Ein entferntes Flugzeuggeräusch weist auf den Flughafen hin.' },
    photos: [
      {
        id: 4,
        label: 'Verwischte Spur',
        filename: 'photo-03-body-top.jpg',
        description: 'Die Perspektive zeigt die Position des Opfers im Raum und mögliche Fluchtwege.',
        archiveRef: 'AKT-1913-01',
        found: false
      }
    ],
    storyIntro: 'Ein Serienkiller lässt kryptische Botschaften zurück. Du musst sein Muster verstehen oder riskierst, die Spur zu verlieren.',
    storyObjectives: ['Botschaft entschlüsseln', 'Poster analysieren', 'Überwachung prüfen'],
    storyStage: 0
  },
  {
    id: 3,
    title: 'Die Dunkle Akte',
    alias: 'Der Maskenpsychologe',
    crime: 'Manipulation, Erpressung und Einschüchterung',
    status: 'Aktiv',
    danger: 'Moderate Gefahr',
    progress: 55,
    summary:
      'Ein Fall, in dem ein ehemaliger Forensiker seine Opfer subtil kontrolliert. Deine Aufgabe: Ressourcen geschickt aufteilen, Hinweise entschlüsseln und den nächsten Schritt vorausplanen.',
    evidence: ['Verletzungsmodell einer Angriffssituation', 'Verdeckte Aussagen eines Zeugen', 'Karte mit markierten Zeitspannen'],
    hint: 'Der Schlüssel liegt in den Entscheidungen, die deine Einsatzteams im Feld treffen.',
    coords: MAP_POSITIONS[2],
    risk: 15,
    onSite: false,
    actionA: false,
    captured: false,
    swatChance: 40,
    boardTime: 180,
    boardSolved: false,
    boardFailed: false,
    boardCards: [
      { id: 9, label: 'Verletzungsmuster', description: 'Das Muster deutet auf gezielte Einschüchterung hin.' },
      { id: 10, label: 'Maskenbild', description: 'Der Täter nutzte ein psychologisches Symbol.' },
      { id: 11, label: 'Zeitplan', description: 'Der Täter arbeitet nach einem strengen Zeitplan.' }
    ],
    boardLinks: [
      { cardIds: [9, 11], result: 'Mega-Hinweis: Der Täter plant seine Einschüchterungen zeitlich genau.' }
    ],
    boardResult: undefined,
    interrogation: {
      prompt: 'Verdächtiger: „Sie verstehen mich nicht, ich wollte nur helfen.“',
      options: ['Sie haben das Opfer bewusst manipuliert.', 'Vielleicht sind Sie unschuldig?', 'Sie sind verängstigt und brauchen einen Anwalt.'],
      correctIndex: 0
    },
    interrogationSolved: false,
    interrogationAborted: false,
    audioTargetFreq: 50,
    audioTargetNoise: 40,
    audioSolved: false,
    audioClue: { id: 12, label: 'Türknarren', description: 'Ein knarrendes Geräusch weist auf den Flur des Tatortes hin.' },
    photos: [
      {
        id: 5,
        label: 'Leiche im Schlafzimmer',
        filename: 'photo-02-victime-bed.jpg',
        description: 'Das Opfer liegt im Bett. Die Szene liefert Hinweise auf den Tatzeitpunkt.',
        archiveRef: 'AKT-1921-01',
        found: false
      }
    ],
    storyIntro: 'Ein gerissener Psychologe führt seine Opfer mit gezielten Manipulationen. Deine Wahl entscheidet, wie schnell du die Wahrheit ans Licht bringst.',
    storyObjectives: ['Täterprofil erstellen', 'Beweise neu ordnen', 'Täterkonfrontation vorbereiten'],
    storyStage: 0
  }
]

const initialUnits: Unit[] = [
  { id: 1, type: 'Patrol', label: 'Streifenwagen', status: 'idle', assignedCaseId: null, coords: HQ },
  { id: 2, type: 'SWAT', label: 'SWAT-Team', status: 'idle', assignedCaseId: null, coords: HQ },
  { id: 3, type: 'Investigator', label: 'Ermittler', status: 'idle', assignedCaseId: null, coords: HQ }
]

function distanceBetween(startX: number, startY: number, targetX: number, targetY: number) {
  return Math.hypot(targetX - startX, targetY - startY)
}

function percentValue(value: string) {
  return Number(value.replace('%', '').trim())
}

function caseDistance(start: CaseCoords, target: CaseCoords) {
  return distanceBetween(percentValue(start.left), percentValue(start.top), percentValue(target.left), percentValue(target.top))
}

function App() {
  const [loggedIn, setLoggedIn] = useState(() => localStorage.getItem('operatorLogin') === 'true')
  const [operatorName, setOperatorName] = useState('Operator')
  const [nameInput, setNameInput] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [cases, setCases] = useState<GameCase[]>(initialCases)
  const [activeCaseIndex, setActiveCaseIndex] = useState(0)
  const [units, setUnits] = useState<Unit[]>(initialUnits)
  const [activeTab, setActiveTab] = useState<TabKey>('map')
  const [boardTimeLeft, setBoardTimeLeft] = useState(initialCases[0].boardTime)
  const [selectedClueIds, setSelectedClueIds] = useState<number[]>([])
  const [boardMessage, setBoardMessage] = useState('')
  const [storyMessage, setStoryMessage] = useState('')
  const [archiveQuery, setArchiveQuery] = useState('')
  const [archiveMessage, setArchiveMessage] = useState('')
  const [showInterrogation, setShowInterrogation] = useState(false)
  const [interrogationBlockade, setInterrogationBlockade] = useState(0)
  const [interrogationMessage, setInterrogationMessage] = useState('')
  const [audioFreq, setAudioFreq] = useState(50)
  const [audioNoise, setAudioNoise] = useState(50)

  const activeCase = useMemo(() => cases[activeCaseIndex] ?? null, [cases, activeCaseIndex])
  const activeApp = useMemo(() => DESKTOP_APPS.find((app) => app.tab === activeTab), [activeTab])
  const activeCaseRef = useRef(activeCase)
  const activeCaseIndexRef = useRef(activeCaseIndex)
  const unitsRef = useRef<Unit[]>(initialUnits) // use to avoid stale state in transition handler
  const currentStoryStage = useMemo(() => {
    if (!activeCase) return null
    const stages = CASE_STORY_STAGES[activeCase.id]
    return stages?.[activeCase.storyStage] ?? null
  }, [activeCase])
  const unitPathsRef = useRef<Record<number, CaseCoords[]>>({})

  useEffect(() => {
    activeCaseRef.current = activeCase
  }, [activeCase])

  useEffect(() => {
    activeCaseIndexRef.current = activeCaseIndex
  }, [activeCaseIndex])

  useEffect(() => {
    unitsRef.current = units
  }, [units])

  useEffect(() => {
    // clear any paths for units that are idle
    for (const id in unitPathsRef.current) {
      const uid = Number(id)
      const unit = units.find((u) => u.id === uid)
      if (!unit || unit.status === 'idle') delete unitPathsRef.current[uid]
    }
  }, [units])

  useEffect(() => {
    localStorage.setItem('operatorLogin', loggedIn ? 'true' : 'false')
  }, [loggedIn])

  useEffect(() => {
    setBoardTimeLeft(activeCase?.boardTime ?? 0)
    setSelectedClueIds([])
    setBoardMessage('')
    setStoryMessage('')
    setArchiveQuery('')
    setArchiveMessage('')
    setShowInterrogation(false)
    setInterrogationBlockade(0)
    setInterrogationMessage('')
    setAudioFreq(50)
    setAudioNoise(50)
  }, [activeCase?.id])

  useEffect(() => {
    if (!loggedIn || !activeCase) return
    addRadioMessage(`Funk: Zentrale an alle Einheiten, wir haben einen 10-31 am Tatort von ${activeCase.alias}.`)
    playAudio(AUDIO_PATHS.caseStart)
  }, [loggedIn, activeCase?.id])

  useEffect(() => {
    if (!activeCase || activeCase.captured || activeCase.boardSolved) return

    const timerId = window.setInterval(() => {
      setBoardTimeLeft((current) => {
        if (current <= 1) {
          handleBoardTimeout()
          return 0
        }
        return current - 1
      })
    }, 1000)

    return () => window.clearInterval(timerId)
  }, [activeCase?.id, activeCase?.captured, activeCase?.boardSolved])

  useEffect(() => {
    if (!activeCase || activeCase.audioSolved) return
    const freqMatch = Math.abs(audioFreq - activeCase.audioTargetFreq) <= 5
    const noiseMatch = Math.abs(audioNoise - activeCase.audioTargetNoise) <= 5
    if (freqMatch && noiseMatch) {
      setCases((currentCases) =>
        currentCases.map((caseItem) => {
          if (caseItem.id !== activeCase.id) return caseItem
          if (caseItem.audioSolved) return caseItem
          addRadioMessage('Audio-Labor: Klarer Hinweis entschlüsselt. Neue Spur auf der Pinnwand verfügbar.')
          playAudio(AUDIO_PATHS.audioSolved)
          const hasClue = caseItem.boardCards.some((card) => card.id === caseItem.audioClue.id)
          return {
            ...caseItem,
            audioSolved: true,
            boardCards: hasClue ? caseItem.boardCards : [...caseItem.boardCards, caseItem.audioClue]
          }
        })
      )
    }
  }, [activeCase, audioFreq, audioNoise])

  const playAudio = (path: string) => {
    try {
      const audio = new Audio(path)
      audio.volume = 0.7
      audio.play().catch(() => {})
    } catch {
      // ignore playback errors
    }
  }

  const [radioLog, setRadioLog] = useState<string[]>([])

  const addRadioMessage = (message: string) => {
    setRadioLog((current) => [message, ...current].slice(0, 8))
  }

  const announceArrival = (unitType: UnitType) => {
    addRadioMessage(`Funk: ${unitType}-Einheit hat den Tatort erreicht.`)
    playAudio(AUDIO_PATHS.arrival)
  }

  const handleBoardTimeout = useCallback(() => {
    if (!activeCaseRef.current) return
    setCases((currentCases) =>
      currentCases.map((caseItem, index) =>
        index !== activeCaseIndexRef.current
          ? caseItem
          : {
              ...caseItem,
              risk: Math.min(100, caseItem.risk + 35),
              summary: `${caseItem.summary} Der Pinnwand-Timer ist abgelaufen. Der Täter nutzt die Unruhe und steigert das Risiko erheblich.`,
              boardFailed: true
            }
      )
    )
    addRadioMessage('Funk: Pinnwand-Timer abgelaufen. Der Fall wird deutlich gefährlicher.')
  }, [])

  const handleLogin = (event: React.FormEvent) => {
    event.preventDefault()
    setLoginError('')

    if (!nameInput.trim() || !loginPassword.trim()) {
      setLoginError('Benutzername und Passwort erforderlich')
      return
    }

    setIsLoggingIn(true)
    window.setTimeout(() => {
      if (loginPassword === 'admin') {
        setOperatorName(nameInput.trim())
        setLoggedIn(true)
        setNameInput('')
        setLoginPassword('')
      } else {
        setLoginError('Falsches Passwort')
      }
      setIsLoggingIn(false)
    }, 500)
  }

  const handleLogout = () => {
    setLoggedIn(false)
    setActiveCaseIndex(0)
    setActiveTab('map')
    setCases(initialCases)
    setUnits(initialUnits)
    setRadioLog([])
    setCanInvestigate(false)
    setCanRaid(false)
  }

  const [canInvestigate, setCanInvestigate] = useState(false)
  const [canRaid, setCanRaid] = useState(false)

  const updateActionButtons = useCallback(() => {
    if (!activeCase) {
      setCanInvestigate(false)
      setCanRaid(false)
      return
    }
    const activeUnits = units.filter((unit) => unit.assignedCaseId === activeCase.id && unit.status === 'onsite')
    setCanInvestigate(activeUnits.some((unit) => unit.type === 'Investigator'))
    setCanRaid(activeUnits.some((unit) => unit.type === 'SWAT'))
  }, [activeCase, units])

  useEffect(() => {
    updateActionButtons()
  }, [updateActionButtons])

  const handleDispatch = (caseId: number, unitId: number) => {
    const caseItem = cases.find((item) => item.id === caseId)
    const unit = units.find((item) => item.id === unitId)
    if (!caseItem || !unit || unit.status !== 'idle' || caseItem.captured) return

    // compute road path: nearest node from unit -> nearest node to case
    const startNode = findNearestNodeId(unit.coords)
    const targetNode = findNearestNodeId(caseItem.coords)
    const nodePath = findPathNodeIds(startNode, targetNode)
    const waypoints: CaseCoords[] = nodePath.map((nid) => nodeById(nid).coords)
    // append final case location
    waypoints.push(caseItem.coords)

    unitPathsRef.current[unitId] = waypoints

    // start movement to first waypoint
    const first = waypoints[0]
    setUnits((currentUnits) =>
      currentUnits.map((item) =>
        item.id === unitId
          ? {
              ...item,
              status: 'traveling',
              assignedCaseId: caseId,
              coords: first
            }
          : item
      )
    )
  }

  const handleUnitArrival = (unitId: number) => {
    const unit = units.find((item) => item.id === unitId)
    if (!unit || unit.status !== 'traveling' || unit.assignedCaseId === null) return

    const caseId = unit.assignedCaseId
    setUnits((currentUnits) =>
      currentUnits.map((item) =>
        item.id === unitId ? { ...item, status: 'onsite' } : item
      )
    )
    setCases((currentCases) =>
      currentCases.map((caseItem) =>
        caseItem.id === caseId ? { ...caseItem, onSite: true, risk: Math.max(0, caseItem.risk - 10) } : caseItem
      )
    )
    announceArrival(unit.type)
    updateActionButtons()
  }

  const handleUnitTransitionEnd = (unit: Unit, event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName !== 'top' || unit.status !== 'traveling') return
    // check if we have more waypoints for this unit
    const path = unitPathsRef.current[unit.id]
    if (!path || path.length === 0) {
      handleUnitArrival(unit.id)
      return
    }
    // we've just reached the first waypoint - remove it
    path.shift()
    if (path.length === 0) {
      // next step is final arrival
      handleUnitArrival(unit.id)
      delete unitPathsRef.current[unit.id]
      return
    }
    // move to next waypoint
    const next = path[0]
    setUnits((currentUnits) =>
      currentUnits.map((item) => (item.id === unit.id ? { ...item, coords: next } : item))
    )
  }

  const handleSelectClue = (id: number) => {
    if (!activeCase || activeCase.boardSolved) return
    setSelectedClueIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length === 2) return [id]
      return [...current, id]
    })
  }

  const handleTryConnect = () => {
    if (!activeCase || selectedClueIds.length !== 2) return
    const [first, second] = selectedClueIds
    const match = activeCase.boardLinks.find(
      (link) =>
        (link.cardIds[0] === first && link.cardIds[1] === second) ||
        (link.cardIds[0] === second && link.cardIds[1] === first)
    )
    if (match) {
      setCases((currentCases) =>
        currentCases.map((caseItem) =>
          caseItem.id !== activeCase.id
            ? caseItem
            : {
                ...caseItem,
                boardSolved: true,
                boardResult: match.result,
                progress: Math.min(100, caseItem.progress + 25)
              }
        )
      )
      setBoardMessage(`Erfolg: ${match.result}`)
      addRadioMessage('Pinnwand erfolgreich verknüpft. Verhör vorbereitet.')
    } else {
      setBoardMessage('Falsche Verbindung. Versuche erneut oder analysiere andere Hinweise.')
      setCases((currentCases) =>
        currentCases.map((caseItem) =>
          caseItem.id !== activeCase.id
            ? caseItem
            : { ...caseItem, risk: Math.min(100, caseItem.risk + 5) }
        )
      )
    }
    setSelectedClueIds([])
  }

  const handleArchiveSearch = () => {
    if (!activeCase) return
    const search = archiveQuery.trim().toUpperCase()
    if (!search) {
      setArchiveMessage('Bitte ein Aktenzeichen eingeben.')
      return
    }
    const foundPhoto = activeCase.photos.find((photo) => photo.archiveRef === search)
    if (!foundPhoto) {
      setArchiveMessage('Kein Eintrag im Archiv mit diesem Aktenzeichen gefunden.')
      return
    }
    if (foundPhoto.found) {
      setArchiveMessage(`Aktenzeichen ${search} wurde bereits gefunden.`)
      return
    }
    setCases((currentCases) =>
      currentCases.map((caseItem) =>
        caseItem.id !== activeCase.id
          ? caseItem
          : {
              ...caseItem,
              photos: caseItem.photos.map((photo) =>
                photo.id === foundPhoto.id ? { ...photo, found: true } : photo
              )
            }
      )
    )
    setArchiveMessage(`Archivfund: ${foundPhoto.label} (${foundPhoto.archiveRef}) freigeschaltet.`)
    addRadioMessage(`Archiv: Aktenzeichen ${search} nachgewiesen.`)
  }

  const handleStoryChoice = (choice: StoryChoice) => {
    if (!activeCase || !currentStoryStage) return
    setCases((currentCases) =>
      currentCases.map((caseItem) => {
        if (caseItem.id !== activeCase.id) return caseItem
        const nextStage = Math.min(
          (caseItem.storyStage ?? 0) + 1,
          (CASE_STORY_STAGES[caseItem.id]?.length ?? 1)
        )
        const nextCards = choice.addCard ? [...caseItem.boardCards, choice.addCard] : caseItem.boardCards
        return {
          ...caseItem,
          progress: Math.min(100, caseItem.progress + choice.progressDelta),
          risk: Math.max(0, Math.min(100, caseItem.risk + choice.riskDelta)),
          storyStage: nextStage,
          boardCards: nextCards
        }
      })
    )
    setStoryMessage(choice.result)
    addRadioMessage(`Story-Entscheidung: ${choice.title}`)
  }

  const handleStartInterrogation = () => {
    if (!activeCase || !activeCase.boardSolved || activeCase.interrogationSolved) return
    setShowInterrogation(true)
    setInterrogationBlockade(0)
    setInterrogationMessage('Verhör gestartet. Wähle die stärkste Aussage aus.')
  }

  const handleInterrogationChoice = (index: number) => {
    if (!activeCase) return
    if (activeCase.interrogation.correctIndex === index) {
      setCases((currentCases) =>
        currentCases.map((caseItem) =>
          caseItem.id !== activeCase.id
            ? caseItem
            : {
                ...caseItem,
                status: 'Festgenommen',
                captured: true,
                onSite: false,
                progress: 100,
                interrogationSolved: true
              }
        )
      )
      setUnits((currentUnits) =>
        currentUnits.map((unit) =>
          unit.assignedCaseId === activeCase.id ? { ...unit, status: 'idle', assignedCaseId: null, coords: HQ } : unit
        )
      )
      setShowInterrogation(false)
      setInterrogationMessage('Geständnis! Der Täter ist gefasst.')
      addRadioMessage('Funk: Verhör erfolgreich. Täter gesteht.')
      if (activeCaseIndex < cases.length - 1) {
        setActiveCaseIndex((current) => current + 1)
      }
      return
    }

    const nextBlockade = interrogationBlockade + 1
    setInterrogationBlockade(nextBlockade)
    if (nextBlockade >= 3) {
      setShowInterrogation(false)
      setInterrogationMessage('Der Verdächtige blockiert. Verhör abgebrochen.')
      setCases((currentCases) =>
        currentCases.map((caseItem) =>
          caseItem.id !== activeCase.id
            ? caseItem
            : {
                ...caseItem,
                risk: Math.min(100, caseItem.risk + 20),
                interrogationAborted: true
              }
        )
      )
      addRadioMessage('Funk: Verhör abgebrochen. Der Verdächtige blockiert.')
      return
    }
    setInterrogationMessage('Falsche Antwort. Der Verdächtige wird misstrauischer.')
  }

  const handleAudioSlider = (type: 'freq' | 'noise', value: number) => {
    if (type === 'freq') setAudioFreq(value)
    else setAudioNoise(value)
  }

  const isBoardAvailable = !!activeCase && (activeCase.onSite || activeCase.boardSolved || activeCase.boardFailed)
  const isInterrogationReady = !!activeCase && activeCase.boardSolved && !activeCase.interrogationSolved && !activeCase.captured
  const audioHintVisible = !!activeCase && Math.abs(audioFreq - activeCase.audioTargetFreq) <= 5 && Math.abs(audioNoise - activeCase.audioTargetNoise) <= 5

  if (!loggedIn) {
    return (
      <div className="app desktop-app">
        <div className="desktop-shell">
          <div className="desktop-wallpaper" />
          <div className="desktop-window screen-shell login-page">
            <div className="screen-topbar">
              <span>FBI SECURE WORKSTATION</span>
              <span>LOGIN REQUIRED</span>
            </div>
            <div className="screen-content login-grid retro-login-grid">
              <div className="login-panel retro-login-panel">
                <div className="fbi-brand retro-brand">
                  <span>SPACE OS</span>
                  <h1>LOGIN</h1>
                  <p>Gib Benutzername und Passwort ein, um das System zu starten.</p>
                </div>
                <form className="login-form retro-login-form" onSubmit={handleLogin}>
                  <label htmlFor="operator-name">Benutzername</label>
                  <input
                    id="operator-name"
                    type="text"
                    value={nameInput}
                    onChange={(event) => setNameInput(event.target.value)}
                    placeholder="admin"
                    required
                    disabled={isLoggingIn}
                  />
                  <label htmlFor="operator-password">Passwort</label>
                  <input
                    id="operator-password"
                    type="password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder="••••••"
                    required
                    disabled={isLoggingIn}
                  />
                  {loginError ? <p className="login-error">{loginError}</p> : null}
                  <button type="submit" disabled={isLoggingIn}>
                    {isLoggingIn ? 'Authentifiziere...' : 'Einloggen'}
                  </button>
                </form>
                <p className="login-note">Benutzer: admin / Passwort: admin</p>
              </div>
              <div className="login-hero">
                <div className="headline">
                  <span>FBI SECURE DESKTOP</span>
                  <h2>Starte deine Ermittlungen von der Einsatzzentrale aus.</h2>
                </div>
                <p>
                  Der Zugriff ist nur autorisierten Operatoren erlaubt. Nutze die Fallübersicht, das Archiv und das Audio-Labor wie in einer echten Einsatzleitstelle.
                </p>
              </div>
            </div>
          </div>
          <div className="taskbar">
            <div className="taskbar-left">FBI SECURE OS</div>
            <div className="taskbar-right">
              <span className="taskbar-icon">🖥️</span>
              <span className="taskbar-icon">🔒</span>
              <span className="taskbar-icon">⚙️</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app desktop-app">
      <div className="desktop-shell">
        <div className="desktop-wallpaper" />
        <div className="desktop-icons-panel">
          {DESKTOP_APPS.map((app) => (
            <button
              key={app.id}
              type="button"
              className={`desktop-app-shortcut ${activeTab === app.tab ? 'active' : ''}`}
              onClick={() => setActiveTab(app.tab)}
            >
              <span className="desktop-app-icon">{app.icon}</span>
              <span>{app.label}</span>
            </button>
          ))}
        </div>

        <div className="desktop-window">
          <div className="screen-shell dashboard">
            <div className="screen-topbar">
              <span>OPERATOR CONTROL HUD</span>
              <span>NETWORK: SECURED</span>
            </div>

            <div className="app-launcher">
              <div className="app-launcher-main">
                <span className="app-launcher-label">Geöffnete App</span>
                <strong>{activeApp?.icon} {activeApp?.label}</strong>
              </div>
              <div className="app-launcher-meta">
                {activeApp?.tab === 'map' && <span>CCTV-Überwachung der Einsatzbereiche</span>}
                {activeApp?.tab === 'board' && <span>Fallakten, Hinweise und Tatort-Archiv</span>}
                {activeApp?.tab === 'audio' && <span>Audio-Analyse und Verschlüsselungsüberwachung</span>}
              </div>
            </div>

            <div className="screen-content">
          <header className="toolbar">
            <div className="brand-bar">
              <div className="brand-mark">FBI</div>
              <div>
                <p className="section-label">WANTED CASE</p>
                <h1>Operator-Dashboard</h1>
              </div>
            </div>
            <div className="operator-card">
              <span>{operatorName}</span>
              <button onClick={handleLogout}>Abmelden</button>
            </div>
          </header>

          <section className="status-panel">
            <div className="status-card">
              <p>Aktueller Fall</p>
              <strong>{activeCase ? `C${activeCase.id}` : 'Keine'}</strong>
            </div>
            <div className="status-card">
              <p>Fortschritt</p>
              <strong>{activeCase ? `${activeCase.progress}%` : '—'}</strong>
            </div>
            <div className="status-card">
              <p>Risiko</p>
              <strong>{activeCase ? `${activeCase.risk}%` : '—'}</strong>
            </div>
          </section>

          <section className="tab-menu">
            <button className={activeTab === 'map' ? 'tab active' : 'tab'} onClick={() => setActiveTab('map')}>
              Einsatzkarte
            </button>
            <button className={activeTab === 'board' ? 'tab active' : 'tab'} onClick={() => setActiveTab('board')}>
              Interaktive Pinnwand
            </button>
            <button className={activeTab === 'audio' ? 'tab active' : 'tab'} onClick={() => setActiveTab('audio')}>
              Cyber-Audio-Labor
            </button>
          </section>

          {activeTab === 'map' && (
            <section className="map-panel">
              <div className="map-frame">
                <div className="map-grid">
                  <div className="hq-pin" style={{ left: HQ.left, top: HQ.top }}>
                    <span>HQ</span>
                  </div>

                  {activeCase && (
                    <div
                      className={`case-pin ${activeCase.captured ? 'captured' : ''}`}
                      style={{ left: activeCase.coords.left, top: activeCase.coords.top }}
                    >
                      <span>{activeCase.id}</span>
                      <div className="pin-ring" />
                      <div className="risk-indicator">
                        <div className="risk-bar" style={{ width: `${activeCase.risk}%` }} />
                      </div>
                    </div>
                  )}

                  {units.map((unit) => {
                    const unitClass = unit.type === 'Investigator' ? 'unit-detective' : unit.type === 'SWAT' ? 'unit-swat' : 'unit-patrol'
                    return (
                      <div
                        key={unit.id}
                        className={`unit-icon ${unitClass}`}
                        style={{ left: unit.coords.left, top: unit.coords.top }}
                        onTransitionEnd={(event) => handleUnitTransitionEnd(unit, event)}
                        title={`${unit.label} ${unit.status === 'traveling' ? `unterwegs zu C${unit.assignedCaseId}` : unit.status === 'onsite' ? `vor Ort C${unit.assignedCaseId}` : 'am HQ'}`}
                      >
                        {unit.type === 'Patrol' ? 'P' : unit.type === 'SWAT' ? 'S' : 'I'}
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="map-sidebar">
                <div className="sidebar-block">
                  <h3>Einheiten</h3>
                  <ul>
                    {units.map((unit) => (
                      <li key={unit.id} className={`unit-line ${unit.status}`}>
                        <strong>{unit.label}</strong>
                        <span>
                          {unit.status === 'idle'
                            ? 'HQ'
                            : unit.status === 'traveling'
                            ? `Anfahrt zu C${unit.assignedCaseId}`
                            : `Vor Ort C${unit.assignedCaseId}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="sidebar-block sidebar-control">
                  <h3>Einheit entsenden</h3>
                  <div className="unit-buttons">
                    {units.filter((unit) => unit.status === 'idle').map((unit) => (
                      <button key={unit.id} type="button" className={`unit-assign unit-${unit.type.toLowerCase()}`} onClick={() => activeCase && handleDispatch(activeCase.id, unit.id)}>
                        {unit.label} frei
                      </button>
                    ))}
                    {units.filter((unit) => unit.status === 'idle').length === 0 ? <p>Keine freien Einheiten verfügbar.</p> : null}
                  </div>
                </div>
                <div className="sidebar-block radio-log-block">
                  <h3>Funksprüche</h3>
                  <div className="radio-log">
                    {radioLog.length > 0 ? (
                      radioLog.map((entry, index) => (
                        <div key={`${entry}-${index}`} className="radio-log-entry">
                          {entry}
                        </div>
                      ))
                    ) : (
                      <p>Keine Funksprüche vorhanden.</p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'board' && activeCase && (
            <section className="board-panel">
              <div className="board-header">
                <div>
                  <p className="section-label">Interaktive Pinnwand</p>
                  <h2>{activeCase.alias}</h2>
                  <p>{activeCase.summary}</p>
                </div>
                <div className="timer-card">
                  <span>Pinnwand-Timer</span>
                  <strong>{boardTimeLeft}s</strong>
                </div>
              </div>
              {currentStoryStage ? (
                <div className="story-panel">
                  <h3>{currentStoryStage.title}</h3>
                  <p>{currentStoryStage.description}</p>
                  <div className="story-choices">
                    {currentStoryStage.choices.map((choice) => (
                      <button key={choice.id} type="button" className="story-choice" onClick={() => handleStoryChoice(choice)}>
                        <strong>{choice.title}</strong>
                        <span>{choice.description}</span>
                      </button>
                    ))}
                  </div>
                  {storyMessage ? <p className="story-message">{storyMessage}</p> : null}
                </div>
              ) : null}
              <div className="archive-panel">
                <h3>Tatort-Archiv</h3>
                <p>Finde die Fotos über ihr Aktenzeichen. Gib das Aktenzeichen ein, um den Archiv-Eintrag aufzurufen.</p>
                <div className="archive-search">
                  <input
                    type="text"
                    placeholder="Aktenzeichen eingeben"
                    value={archiveQuery}
                    onChange={(event) => setArchiveQuery(event.target.value)}
                  />
                  <button type="button" onClick={handleArchiveSearch}>
                    Archiv durchsuchen
                  </button>
                </div>
                {archiveMessage ? <p className="archive-message">{archiveMessage}</p> : null}
                <div className="photo-gallery">
                  {activeCase.photos.filter((photo) => photo.found).length > 0 ? (
                    activeCase.photos
                      .filter((photo) => photo.found)
                      .map((photo) => (
                        <div key={photo.id} className="photo-card">
                          <img src={`/fotos/${photo.filename}`} alt={photo.label} />
                          <div>
                            <strong>{photo.label}</strong>
                            <p>{photo.description}</p>
                            <p className="archive-ref">Aktenzeichen: {photo.archiveRef}</p>
                          </div>
                        </div>
                      ))
                  ) : (
                    <p className="archive-hint">Noch keine Fotos gefunden. Suche nach dem richtigen Aktenzeichen.</p>
                  )}
                </div>
              </div>
              <div className="board-grid">
                <div className="clue-column">
                  <h3>Hinweise</h3>
                  <div className={`clue-list ${isBoardAvailable ? '' : 'disabled'}`}>
                    {activeCase.boardCards.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        className={`clue-card ${selectedClueIds.includes(card.id) ? 'selected' : ''}`}
                        onClick={() => handleSelectClue(card.id)}
                        disabled={!isBoardAvailable || activeCase.boardSolved}
                      >
                        <strong>{card.label}</strong>
                        <p>{card.description}</p>
                      </button>
                    ))}
                  </div>
                  <div className="connect-panel">
                    <button type="button" onClick={handleTryConnect} disabled={selectedClueIds.length !== 2 || !isBoardAvailable || activeCase.boardSolved}>
                      Verbindung prüfen
                    </button>
                    {boardMessage ? <p className="board-message">{boardMessage}</p> : null}
                    {activeCase.boardResult ? <p className="board-result">{activeCase.boardResult}</p> : null}
                  </div>
                </div>
                <div className="interrogation-column">
                  <h3>Verhör</h3>
                  <div className="interrogation-panel">
                    <p>Status: {activeCase.boardSolved ? 'Pinnwand gelöst' : 'Warte auf Ermittler'}</p>
                    <button type="button" onClick={handleStartInterrogation} disabled={!isInterrogationReady}>
                      Verhör starten
                    </button>
                    {activeCase.interrogationSolved ? <p className="success-text">Der Täter ist geständig. Fall gelöst.</p> : null}
                    {activeCase.interrogationAborted ? <p className="warning-text">Verhör abgebrochen. Risiko gestiegen.</p> : null}
                  </div>
                  <div className="evidence-block">
                    <h4>Beweise</h4>
                    <ul>
                      {activeCase.evidence.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
              {showInterrogation && (
                <div className="dialog-overlay">
                  <div className="dialog-box">
                    <h3>Verdächtigen-Verhör</h3>
                    <p>{activeCase.interrogation.prompt}</p>
                    <div className="dialog-options">
                      {activeCase.interrogation.options.map((option, index) => (
                        <button key={option} type="button" onClick={() => handleInterrogationChoice(index)}>
                          {option}
                        </button>
                      ))}
                    </div>
                    <p className="dialog-status">Blockade: {interrogationBlockade} / 3</p>
                    <p className="dialog-message">{interrogationMessage}</p>
                  </div>
                </div>
              )}
            </section>
          )}

          {activeTab === 'audio' && activeCase && (
            <section className="audio-panel">
              <div className="audio-header">
                <div>
                  <p className="section-label">Cyber-Audio-Labor</p>
                  <h2>Analyse der Verschlüsselten Tonspur</h2>
                </div>
                <div className="audio-note">Ziel: Frequenz {activeCase.audioTargetFreq}, Rauschen {activeCase.audioTargetNoise}</div>
              </div>
              <div className="audio-grid">
                <div className="slider-card">
                  <label htmlFor="freq-slider">Frequenz-Filter</label>
                  <input
                    id="freq-slider"
                    type="range"
                    min={0}
                    max={100}
                    value={audioFreq}
                    onChange={(event) => handleAudioSlider('freq', Number(event.target.value))}
                  />
                  <span>{audioFreq}</span>
                </div>
                <div className="slider-card">
                  <label htmlFor="noise-slider">Rauschunterdrückung</label>
                  <input
                    id="noise-slider"
                    type="range"
                    min={0}
                    max={100}
                    value={audioNoise}
                    onChange={(event) => handleAudioSlider('noise', Number(event.target.value))}
                  />
                  <span>{audioNoise}</span>
                </div>
                <div className="audio-display">
                  {activeCase.audioSolved ? (
                    <>
                      <p className="audio-clear">*Kirchenglocken im Hintergrund* → Hinweis 'Kirche' freigeschaltet!</p>
                      <p>{activeCase.audioClue.description}</p>
                    </>
                  ) : (
                    <p className="audio-noise">[Unverständliches Kratzen]</p>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  </div>
</div>
  )
}

export default App
