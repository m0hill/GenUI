import assert from "node:assert/strict"
import { test } from "node:test"
import { createGenuiManifest } from "./default-primitives.js"
import { registerGeneratedSurface, verifyGeneratedSurfaceGrant } from "./surfaces.js"

void test("generated surfaces verify granted capability requests", () => {
  const surface = registerGeneratedSurface({
    chatId: "chat-1",
    toolCallId: "tool-1",
    html: "<section>Weather</section>",
    manifest: createGenuiManifest(["demo.weather.lookup"]),
  })

  assert.equal(
    verifyGeneratedSurfaceGrant({
      surfaceId: surface.id,
      surfaceToken: surface.token,
      chatId: "chat-1",
      capability: "demo.weather.lookup",
    }).ok,
    true,
  )

  assert.equal(
    verifyGeneratedSurfaceGrant({
      surfaceId: surface.id,
      surfaceToken: surface.token,
      chatId: "chat-1",
      capability: "demo.notes.create",
    }).ok,
    false,
  )
})

void test("generated surface verification rejects invalid identity", () => {
  const surface = registerGeneratedSurface({
    chatId: "chat-1",
    toolCallId: "tool-2",
    html: "<section>Palette</section>",
    manifest: createGenuiManifest(["demo.palette.generate"]),
  })

  assert.equal(
    verifyGeneratedSurfaceGrant({
      surfaceId: surface.id,
      surfaceToken: "not-the-token",
      chatId: "chat-1",
      capability: "demo.palette.generate",
    }).ok,
    false,
  )

  assert.equal(
    verifyGeneratedSurfaceGrant({
      surfaceId: surface.id,
      surfaceToken: surface.token,
      chatId: "chat-2",
      capability: "demo.palette.generate",
    }).ok,
    false,
  )
})
