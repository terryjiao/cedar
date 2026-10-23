import type { DshReadiness, SourceBundle } from './types.js';

/** Source clues are intentionally distinct from runtime or configuration verification. */
export function inspectDsh(bundle: SourceBundle): DshReadiness {
  const artifacts = bundle.sources.filter(s => /deepseek-harness|@deepseek-ai\/dsh|\bDSH\b/.test(s.path + '\n' + s.content)).map(s => s.path);
  const profiles = bundle.sources.filter(s => /cordis.*\.ya?ml$/.test(s.path) || /"dsh"\s*:\s*\{|"dsh\.profile"/.test(s.content)).map(s => s.path);
  const tests = bundle.sources.filter(s => s.kind === 'test').map(s => s.path);
  return {
    runtime: 'dsh', status: 'not-executed', checks: [
      { id: 'runtime-artifacts', status: artifacts.length ? 'observed' : 'not-observed', description: 'DSH references in collected files; this does not verify an installed runtime.', sources: artifacts },
      { id: 'profile-composition', status: profiles.length ? 'observed' : 'not-observed', description: 'Candidate profile/configuration files; effective plugin composition still needs a runtime probe.', sources: profiles },
      { id: 'existing-tests', status: tests.length ? 'observed' : 'not-observed', description: 'Existing test source files; test outcomes and full-task coverage have not been assessed.', sources: tests },
      { id: 'runtime-fidelity', status: 'unverified', description: 'Confirm the automation entry preserves the target prompts, tools, plugins and input context.', sources: [] },
      { id: 'state-isolation', status: 'unverified', description: 'Locate initial files, memory and other persistent state; verify isolated preparation and reset.', sources: [] },
      { id: 'completion-and-artifacts', status: 'unverified', description: 'Verify task completion, background work, final artifacts and lossless execution evidence.', sources: [] }
    ]
  };
}
