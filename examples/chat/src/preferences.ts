import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"

export const PreferredTripName = z.string().trim().min(1).max(100)

const StoredPreference = z
  .object({
    preferredTrip: PreferredTripName,
    updatedAt: z.iso.datetime(),
  })
  .strict()

type StoredPreference = z.infer<typeof StoredPreference>

/** JSON-backed storage for the example app's single saved trip preference. */
export class JsonPreferenceStore {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async get(): Promise<StoredPreference | undefined> {
    await this.writeQueue

    let content: string
    try {
      content = await readFile(this.filePath, "utf8")
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined
      }
      throw error
    }

    let value: unknown
    try {
      value = JSON.parse(content) as unknown
    } catch (cause) {
      throw new Error(`Preference store is invalid: ${this.filePath}`, { cause })
    }
    const preference = StoredPreference.safeParse(value)
    if (!preference.success) {
      throw new Error(`Preference store is invalid: ${this.filePath}`, {
        cause: preference.error,
      })
    }
    return preference.data
  }

  save(preferredTrip: string): Promise<StoredPreference> {
    const name = PreferredTripName.parse(preferredTrip)
    const preference: StoredPreference = {
      preferredTrip: name,
      updatedAt: new Date().toISOString(),
    }
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(preference, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      })
      await rename(temporaryPath, this.filePath)
    })

    this.writeQueue = write.catch(() => undefined)
    return write.then(() => preference)
  }
}
