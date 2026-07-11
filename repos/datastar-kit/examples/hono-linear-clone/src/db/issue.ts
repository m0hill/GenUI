import { asc, desc, eq, max } from "drizzle-orm"
import { db } from "./index.js"
import {
  comments,
  issues,
  projects,
  users,
  type IssuePriority,
  type IssueStatus,
  type User
} from "./schema.js"

export const readIssues = async () =>
  db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      description: issues.description,
      status: issues.status,
      priority: issues.priority,
      updatedAt: issues.updatedAt,
      projectId: projects.id,
      projectKey: projects.key,
      projectName: projects.name,
      assigneeName: users.name
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .leftJoin(users, eq(users.id, issues.assigneeId))
    .orderBy(desc(issues.updatedAt), desc(issues.id))

export type Issue = Awaited<ReturnType<typeof readIssues>>[number]

export const loadIssueRecord = async (issueId: number) => {
  const [issue] = await db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      description: issues.description,
      status: issues.status,
      priority: issues.priority,
      createdAt: issues.createdAt,
      updatedAt: issues.updatedAt,
      projectKey: projects.key,
      projectName: projects.name,
      creatorName: users.name
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .innerJoin(users, eq(users.id, issues.createdById))
    .where(eq(issues.id, issueId))
    .limit(1)

  return issue ?? null
}

export const loadIssueComments = async (issueId: number) =>
  db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      authorName: users.name
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.issueId, issueId))
    .orderBy(asc(comments.createdAt))

export const loadIssue = async (issueId: number) => {
  const issue = await loadIssueRecord(issueId)
  if (issue === null) {
    return null
  }

  const issueComments = await loadIssueComments(issueId)

  return { issue, comments: issueComments }
}

export type IssueDetail = NonNullable<Awaited<ReturnType<typeof loadIssue>>>
export type IssueRecord = Awaited<ReturnType<typeof loadIssueRecord>>
export type IssueComments = Awaited<ReturnType<typeof loadIssueComments>>

export const createIssue = async (
  user: User,
  input: {
    projectId: number
    issueTitle: string
    issueDescription?: string | undefined
    issueStatus: IssueStatus
    issuePriority: IssuePriority
  }
) => {
  const [last] = await db
    .select({ number: max(issues.number) })
    .from(issues)
    .where(eq(issues.projectId, input.projectId))
  const nextNumber = (last?.number ?? 0) + 1

  const [issue] = await db
    .insert(issues)
    .values({
      projectId: input.projectId,
      number: nextNumber,
      title: input.issueTitle,
      description: input.issueDescription ?? "",
      status: input.issueStatus,
      priority: input.issuePriority,
      createdById: user.id,
      assigneeId: user.id,
      updatedAt: new Date()
    })
    .returning()

  if (issue === undefined) {
    throw new Error("Failed to create issue")
  }

  return issue
}

export const updateIssue = async (
  issueId: number,
  input: { status?: IssueStatus | undefined; priority?: IssuePriority | undefined }
) => {
  await db
    .update(issues)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(issues.id, issueId))
}

export const createComment = async (user: User, issueId: number, body: string) => {
  await db.insert(comments).values({
    issueId,
    authorId: user.id,
    body
  })
  await db.update(issues).set({ updatedAt: new Date() }).where(eq(issues.id, issueId))
}
