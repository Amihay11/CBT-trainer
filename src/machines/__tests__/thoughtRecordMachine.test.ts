/**
 * Protocol-machine tests. The DB save actor is overridden with a fake via `machine.provide`,
 * so guards, transitions, the save→completed happy path, and bounded error-retry are all
 * exercised without a native database.
 */
import { createActor, fromPromise, waitFor } from 'xstate';

import { thoughtRecordMachine } from '../thoughtRecordMachine';
import { CognitiveDistortion } from '../../domain/thoughtRecord';

function buildActor(saveImpl: () => Promise<string>) {
  const machine = thoughtRecordMachine.provide({
    actors: { saveThoughtRecord: fromPromise(saveImpl) },
  });
  return createActor(machine, { input: { userId: 'user-1' } });
}

/** Advances a started actor to the `tagging_distortions` step with a valid draft. */
function fillThroughDistortions(actor: ReturnType<typeof buildActor>) {
  actor.send({ type: 'START', userId: 'user-1' });
  actor.send({ type: 'SET_SITUATION', situation: 'My manager did not reply all day.' });
  actor.send({ type: 'NEXT_STEP' });
  actor.send({ type: 'SET_EMOTION', emotion: 'Anxious', emotionIntensity: 70 });
  actor.send({ type: 'NEXT_STEP' });
  actor.send({ type: 'SET_AUTOMATIC_THOUGHT', automaticThought: 'He is ignoring me on purpose.' });
  actor.send({ type: 'NEXT_STEP' });
}

describe('thoughtRecordMachine', () => {
  it('blocks advancing out of analyzing_situation without a situation (guard)', () => {
    const actor = buildActor(async () => 'rec-1');
    actor.start();
    actor.send({ type: 'START', userId: 'user-1' });
    expect(actor.getSnapshot().value).toBe('analyzing_situation');

    actor.send({ type: 'NEXT_STEP' }); // situation is empty → guard blocks
    expect(actor.getSnapshot().value).toBe('analyzing_situation');

    actor.send({ type: 'SET_SITUATION', situation: 'Something happened.' });
    actor.send({ type: 'NEXT_STEP' });
    expect(actor.getSnapshot().value).toBe('identifying_emotions');
  });

  it('requires an automatic thought of at least 3 words', () => {
    const actor = buildActor(async () => 'rec-1');
    actor.start();
    actor.send({ type: 'START', userId: 'user-1' });
    actor.send({ type: 'SET_SITUATION', situation: 'A situation.' });
    actor.send({ type: 'NEXT_STEP' });
    actor.send({ type: 'SET_EMOTION', emotion: 'Sad', emotionIntensity: 40 });
    actor.send({ type: 'NEXT_STEP' });

    actor.send({ type: 'SET_AUTOMATIC_THOUGHT', automaticThought: 'Bad' }); // 1 word
    actor.send({ type: 'NEXT_STEP' });
    expect(actor.getSnapshot().value).toBe('catching_automatic_thoughts');

    actor.send({ type: 'SET_AUTOMATIC_THOUGHT', automaticThought: 'I am a failure.' });
    actor.send({ type: 'NEXT_STEP' });
    expect(actor.getSnapshot().value).toBe('tagging_distortions');
  });

  it('blocks leaving tagging_distortions with an empty list unless bypassed', () => {
    const actor = buildActor(async () => 'rec-1');
    actor.start();
    fillThroughDistortions(actor);
    expect(actor.getSnapshot().value).toBe('tagging_distortions');

    actor.send({ type: 'NEXT_STEP' }); // no distortions selected, no bypass → blocked
    expect(actor.getSnapshot().value).toBe('tagging_distortions');

    actor.send({ type: 'NEXT_STEP', bypassDistortions: true }); // explicit bypass allowed
    expect(actor.getSnapshot().value).toBe('restructuring_thought');
  });

  it('persists via the save actor and reaches completed with the saved id', async () => {
    const actor = buildActor(async () => 'saved-record-42');
    actor.start();
    fillThroughDistortions(actor);
    actor.send({ type: 'TOGGLE_DISTORTION', distortion: CognitiveDistortion.MIND_READING });
    actor.send({ type: 'NEXT_STEP' });
    actor.send({ type: 'SET_BALANCED_THOUGHT', balancedThought: 'He is probably just busy.' });
    actor.send({ type: 'NEXT_STEP' });

    const done = await waitFor(actor, (s) => s.matches('completed'));
    expect(done.context.savedRecordId).toBe('saved-record-42');
  });

  it('falls to error on save failure and allows bounded retry', async () => {
    let attempts = 0;
    const actor = buildActor(async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('disk full');
      return 'saved-on-retry';
    });
    actor.start();
    fillThroughDistortions(actor);
    actor.send({ type: 'NEXT_STEP', bypassDistortions: true });
    actor.send({ type: 'SET_BALANCED_THOUGHT', balancedThought: 'A fairer view.' });
    actor.send({ type: 'NEXT_STEP' });

    const errored = await waitFor(actor, (s) => s.matches('error'));
    expect(errored.context.errorMessage).toContain('disk full');

    actor.send({ type: 'RETRY' });
    const recovered = await waitFor(actor, (s) => s.matches('completed'));
    expect(recovered.context.savedRecordId).toBe('saved-on-retry');
    expect(recovered.context.retryCount).toBe(1);
  });
});
