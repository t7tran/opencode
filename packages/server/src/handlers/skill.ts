import { Agent } from "@opencode/core/agent" // fork_change
import { Skill } from "@opencode/core/skill"
import { Effect } from "effect" // fork_change
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

// fork_change start
// No Session here, so a skill drops out only when every agent's rules deny it.
const enabledSkills = Effect.gen(function* () {
  const skills = yield* Skill.Service.use((skill) => skill.list())
  return Skill.enabled(skills, yield* Agent.Service.use((agent) => agent.list()))
})
// fork_change end

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers.handle("skill.list", () => response(enabledSkills /* fork_change */)),
)
