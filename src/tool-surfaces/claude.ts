import * as z from "zod/v4";
import {
  editFileTool,
  runShellTool,
  writeFileTool,
} from "../pi-tools.js";
import {
  EDIT_TOOL_ANNOTATIONS,
  SHELL_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  toolNames,
  workspaceIdDescription,
  type ToolInstructionContext,
  type ToolRegistrationContext,
} from "./types.js";
import {
  contentText,
  countDiffStats,
  logFailedToolResponse,
  logToolCall,
  resultOutputSchema,
  textBlock,
} from "./shared.js";

const CLAUDE_INSTRUCTIONS = `Follow instructions returned by ${toolNames.openWorkspace}; read applicable instruction and skill files before working in their scope.`;

export function claudeInstructions({
  agents,
  skills,
}: ToolInstructionContext): string {
  return `${agents}${skills}${CLAUDE_INSTRUCTIONS}`;
}

export function registerClaudeTools(context: ToolRegistrationContext): void {
  registerClaudeMutationTools(context);
  registerShellTool(context);
}

const CLAUDE_SHELL_DESCRIPTION = "Run a shell command in a workspace with the user's local permissions.";

function requireWorkspaceId(
  legacyWorkspaceId: string | undefined,
  workspaceId: string | undefined,
): string {
  const resolved = legacyWorkspaceId ?? workspaceId;
  if (!resolved) throw new Error("workspaceId or workspace_id is required.");
  return resolved;
}

function registerClaudeMutationTools(context: ToolRegistrationContext): void {
  const { server, config, workspaces } = context;

  server.registerTool(
    toolNames.write,
    {
      title: "Write file",
      description: "Create or completely overwrite a file in a workspace.",
      inputSchema: {
        workspaceId: z.string().optional().describe(workspaceIdDescription),
        workspace_id: z.string().optional().describe(workspaceIdDescription),
        path: z
          .string()
          .describe("File path to write, relative to the workspace root."),
        content: z.string().describe("Complete new file content."),
      },
      outputSchema: resultOutputSchema(),
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId: legacyWorkspaceId, workspace_id, ...input }) => {
      const startedAt = performance.now();
      const workspaceId = requireWorkspaceId(legacyWorkspaceId, workspace_id);
      const workspace = await workspaces.getWorkspace(workspaceId);
      const path = await workspaces.resolvePath(workspace, input.path);
      const response = await writeFileTool({ ...input, path }, { cwd: workspace.root });

      if (response.isError) {
        logFailedToolResponse(
          config,
          {
            tool: toolNames.write,
            workspaceId,
            path: input.path,
          },
          response.content,
          startedAt,
        );
        return response;
      }

      logToolCall(config, {
        tool: toolNames.write,
        workspaceId,
        path: input.path,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        ...response,
        structuredContent: {
          result: contentText(response.content),
        },
      };
    },
  );

  server.registerTool(
    toolNames.edit,
    {
      title: "Edit file",
      description:
        "Edit one file in a workspace by replacing exact text blocks. Supports both legacy camelCase and current snake_case input names.",
      inputSchema: {
        workspaceId: z.string().optional().describe(workspaceIdDescription),
        workspace_id: z.string().optional().describe(workspaceIdDescription),
        path: z
          .string()
          .describe("File path to edit, relative to the workspace root."),
        edits: z
          .array(
            z.object({
              oldText: z.string().optional(),
              newText: z.string().optional(),
              old_text: z.string().optional(),
              new_text: z.string().optional(),
            }),
          )
          .min(1),
      },
      outputSchema: resultOutputSchema({
        status: z.literal("applied"),
      }),
      annotations: EDIT_TOOL_ANNOTATIONS,
    },
    async ({
      workspaceId: legacyWorkspaceId,
      workspace_id,
      edits,
      ...input
    }) => {
      const startedAt = performance.now();
      const workspaceId = requireWorkspaceId(legacyWorkspaceId, workspace_id);
      const workspace = await workspaces.getWorkspace(workspaceId);
      const path = await workspaces.resolvePath(workspace, input.path);
      const normalizedEdits = edits.map((edit) => {
        const oldText = edit.oldText ?? edit.old_text;
        const newText = edit.newText ?? edit.new_text;
        if (oldText === undefined || newText === undefined) {
          throw new Error("Each edit requires oldText/newText or old_text/new_text.");
        }
        return { oldText, newText };
      });
      const response = await editFileTool({
        ...input,
        path,
        edits: normalizedEdits,
      }, { cwd: workspace.root });

      if (response.isError) {
        logFailedToolResponse(
          config,
          {
            tool: toolNames.edit,
            workspaceId,
            path: input.path,
          },
          response.content,
          startedAt,
        );
        return response;
      }

      const stats = countDiffStats(
        response.details?.patch ?? response.details?.diff,
      );
      const editResultText = `Edited ${input.path} (+${stats.additions} -${stats.removals}).`;
      const editContent = [textBlock(editResultText)];
      logToolCall(config, {
        tool: toolNames.edit,
        workspaceId,
        path: input.path,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        content: editContent,
        structuredContent: {
          status: "applied",
          result: contentText(editContent),
        },
      };
    },
  );
}

function registerShellTool(context: ToolRegistrationContext): void {
  const { server, config, workspaces } = context;

  server.registerTool(
    toolNames.shell,
    {
      title: "Bash",
      description: CLAUDE_SHELL_DESCRIPTION,
      inputSchema: {
        workspaceId: z.string().optional().describe(workspaceIdDescription),
        workspace_id: z.string().optional().describe(workspaceIdDescription),
        command: z
          .string()
          .describe("Shell command to execute."),
        workingDirectory: z.string().optional(),
        working_directory: z
          .string()
          .optional()
          .describe(
            "Optional working directory relative to the workspace root. Defaults to the workspace root.",
          ),
        timeout: z
          .number()
          .positive()
          .max(300)
          .optional()
          .describe("Timeout in seconds. Defaults to 30, max 300."),
      },
      outputSchema: resultOutputSchema(),
      annotations: SHELL_TOOL_ANNOTATIONS,
    },
    async ({
      workspaceId: legacyWorkspaceId,
      workspace_id,
      workingDirectory: legacyWorkingDirectory,
      working_directory,
      ...input
    }) => {
      const startedAt = performance.now();
      const workspaceId = requireWorkspaceId(legacyWorkspaceId, workspace_id);
      const workingDirectory = legacyWorkingDirectory ?? working_directory;
      const workspace = await workspaces.getWorkspace(workspaceId);
      const cwd = await workspaces.resolveWorkingDirectory(
        workspace,
        workingDirectory,
      );
      const response = await runShellTool(input, {
        cwd,
      });

      if (response.isError) {
        logFailedToolResponse(
          config,
          {
            tool: toolNames.shell,
            workspaceId,
            workingDirectory: workingDirectory ?? ".",
            command: input.command,
            commandLength: input.command.length,
          },
          response.content,
          startedAt,
        );
        return response;
      }

      logToolCall(config, {
        tool: toolNames.shell,
        workspaceId,
        workingDirectory: workingDirectory ?? ".",
        command: input.command,
        commandLength: input.command.length,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        ...response,
        structuredContent: {
          result: contentText(response.content),
        },
      };
    },
  );
}
