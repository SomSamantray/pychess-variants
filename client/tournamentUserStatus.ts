// Paused and withdrawn players keep their row in the standings, so the
// "scroll to your player" control still has a target for them.
const PARTICIPANT_STATUSES = ['joined', 'paused', 'withdrawn'];

export function isParticipantStatus(ustatus: string): boolean {
    return PARTICIPANT_STATUSES.includes(ustatus);
}
