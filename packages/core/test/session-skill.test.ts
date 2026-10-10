import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, LayerMap } from "effect"
import { Agent } from "@opencode/core/agent" // fork_change
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "@opencode/core/bus"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionInbox } from "@opencode/core/session/inbox"
import { Skill } from "@opencode/core/skill"
import { Event } from "@opencode/schema/event"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const info = Skill.Info.make({
  id: Skill.ID.make("effect"),
  name: Skill.Name.make("Effect"),
  description: "Effect guidance",
  path: AbsolutePath.make(path.resolve("/skills/effect.md")),
  content: "  Use Effect\n",
})
// fork_change start
const off = Skill.Info.make({
  id: Skill.ID.make("off"),
  name: Skill.Name.make("Off"),
  description: "Denied for the agent",
  path: AbsolutePath.make(path.resolve("/skills/off.md")),
  content: "Should not load\n",
})
const skills = [info, off]
const agent = Agent.Info.make({
  ...Agent.Info.default(Agent.defaultID),
  permissions: [{ action: "skill", resource: off.id, effect: "deny" }],
})
// fork_change end
const locations = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make(
      (_ref: Location.Ref) =>
        // These tests need skill activation and prompt preparation from the same location services.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        Layer.mergeAll(
          LayerNode.compile(LayerNode.group([PluginHooks.node, Image.node])),
          Layer.mock(Skill.Service, {
            get: (id) => Effect.succeed(skills.find((skill) => skill.id === id)), // fork_change
            list: () => Effect.succeed(skills), // fork_change
          }),
          Layer.mock(Agent.Service, { resolve: () => Effect.succeed(agent) }), // fork_change
          Layer.mock(Plugin.Service, { awaitActivation: Effect.void }),
        ) as unknown as Layer.Layer<LocationServices>,
    ),
  ),
  deps: [],
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      LocationServiceMap.node.replace(locations),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

describe("Session.skill", () => {
  it.effect("materializes mentioned skills on their owning prompt", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location })
      const id = SessionMessage.ID.make("msg_skill_attachment")

      yield* sessions.prompt({
        id,
        sessionID: session.id,
        text: "Apply @effect and @effect",
        skills: [
          { id: Skill.ID.make("effect"), mention: { start: 6, end: 13, text: "@effect" } },
          { id: Skill.ID.make("effect"), mention: { start: 18, end: 25, text: "@effect" } },
        ],
        resume: false,
      })
      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")

      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([
        expect.objectContaining({
          id,
          type: "user",
          text: "Apply @effect and @effect",
          skills: [
            {
              id: "effect",
              name: "Effect",
              text: Skill.toModelOutput(info, []),
              mention: { start: 6, end: 13, text: "@effect" },
            },
            {
              id: "effect",
              name: "Effect",
              mention: { start: 18, end: 25, text: "@effect" },
            },
          ],
        }),
      ])
    }),
  )

  it.effect("excludes mentioned skills when forking before their prompt", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location })
      const initial = SessionMessage.ID.make("msg_before_skill_attachment")
      const selected = SessionMessage.ID.make("msg_fork_skill_attachment")

      yield* sessions.prompt({ id: initial, sessionID: session.id, text: "Before the skill", resume: false })
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")
      yield* sessions.prompt({
        id: selected,
        sessionID: session.id,
        text: "Apply @effect",
        skills: [{ id: info.id, mention: { start: 6, end: 13, text: "@effect" } }],
        resume: false,
      })
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")
      const forked = yield* sessions.fork({ sessionID: session.id, before: selected })

      expect(yield* sessions.messages({ sessionID: forked.id })).toEqual([
        expect.objectContaining({ type: "user", text: "Before the skill" }),
      ])
    }),
  )

  it.effect("publishes raw standalone content under the caller-supplied ID without inbox admission", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location })
      const id = SessionMessage.ID.make("msg_caller_skill")
      const events: Event.Payload[] = []
      yield* bus.listen((event) =>
        Effect.sync(() => {
          events.push(event)
        }),
      )

      yield* sessions.skill({ messageID: id, sessionID: session.id, skill: Skill.ID.make("effect"), resume: false })

      expect(events).toEqual([
        expect.objectContaining({
          id: "evt_caller_skill",
          type: SessionEvent.Skill.Activated.type,
          data: { sessionID: session.id, id: info.id, name: info.name, text: info.content },
        }),
      ])
      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([
        expect.objectContaining({ id, type: "skill", skill: "effect", name: "Effect", text: info.content }),
      ])
      expect(yield* sessions.inbox(session.id)).toEqual([])
    }),
  )

  // fork_change start
  it.effect("refuses a prompt that attaches a skill the agent denies", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })

      const error = yield* sessions
        .prompt({
          id: SessionMessage.ID.make("msg_denied_skill"),
          sessionID: session.id,
          text: "Apply @off",
          skills: [{ id: off.id, mention: { start: 6, end: 10, text: "@off" } }],
          resume: false,
        })
        .pipe(Effect.flip)

      expect(error).toMatchObject({ _tag: "Session.SkillNotFoundError", skill: off.id, denied: true })
      expect(yield* sessions.inbox(session.id)).toEqual([])
    }),
  )

  it.effect("refuses an attached skill the Session's own rules deny", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })
      yield* sessions.setPermissions({
        sessionID: session.id,
        permissions: [{ action: "skill", resource: info.id, effect: "deny" }],
      })

      const error = yield* sessions
        .prompt({
          id: SessionMessage.ID.make("msg_session_denied_skill"),
          sessionID: session.id,
          text: "Apply @effect",
          skills: [{ id: info.id, mention: { start: 6, end: 13, text: "@effect" } }],
          resume: false,
        })
        .pipe(Effect.flip)

      expect(error).toMatchObject({ _tag: "Session.SkillNotFoundError", skill: info.id, denied: true })
    }),
  )

  it.effect("refuses to activate a skill the agent denies", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })

      expect(
        yield* sessions.skill({ sessionID: session.id, skill: off.id, resume: false }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.SkillNotFoundError", skill: off.id, denied: true })
      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
    }),
  )
  // fork_change end
})
