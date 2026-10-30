export * as SessionSkill from "./skill.js"

import type { Session } from "@opencode/schema/session"
import { Effect } from "effect"
import { Agent } from "../agent.js" // fork_change
import { Instance } from "../instance/service.js"
import { Permission } from "../permission.js" // fork_change
import { Plugin } from "../plugin/service.js"
import { Skill } from "../skill.js"
import { SkillNotFoundError } from "./error.js"

export const get = Effect.fn("SessionSkill.get")(function* (input: { session: Session.Info; skill: Skill.ID }) {
  const instances = yield* Instance.Service
  // fork_change start
  const [skills, agents] = yield* Plugin.awaitActivation.pipe(
    Effect.andThen(Effect.all([Skill.Service, Agent.Service])),
    instances.provide(input.session),
  )
  // fork_change end
  const skill = yield* skills.get(input.skill)
  if (!skill) return yield* new SkillNotFoundError({ skill: input.skill })
  yield* assertEnabled(input.session, skill).pipe(Effect.provideService(Agent.Service, agents)) // fork_change
  return skill
})

// fork_change start
// A skill the Session's agent (plus the Session's own rules) denies is switched off, as the skill tool treats it.
// Needs the Session's location services.
export const assertEnabled = Effect.fn("SessionSkill.assertEnabled")(function* (
  session: Session.Info,
  skill: Skill.Info,
) {
  const agent = yield* Agent.Service.use((agents) => agents.resolve(session.agent))
  const permissions = Permission.merge(agent?.permissions ?? [], session.permissions ?? [])
  if (Skill.available([skill], permissions).length === 0)
    return yield* new SkillNotFoundError({ skill: skill.id, denied: true })
})
// fork_change end
