import { useState, memo, useMemo, useCallback, useEffect } from "react";
import type React from "react";
import type { JsonValue } from "@/utils/jsonUtils";
import clsx from "clsx";
import { Copy, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/hooks/useToast";
import { getDataType, tryParseJson } from "@/utils/jsonUtils";
import useCopy from "@/lib/hooks/useCopy";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const byteEncoder =
  typeof TextEncoder !== "undefined" ? new TextEncoder() : undefined;

const getByteLength = (value: string): number => {
  if (byteEncoder) {
    return byteEncoder.encode(value).length;
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf-8").length;
  }

  return value.length;
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const formattedSize =
    size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${formattedSize} ${units[unitIndex]}`;
};

const formatPercentage = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0%";
  }

  if (value >= 99.5) {
    return "100%";
  }

  if (value >= 10) {
    return `${value.toFixed(0)}%`;
  }

  if (value >= 1) {
    return `${value.toFixed(1)}%`;
  }

  return `${value.toFixed(2)}%`;
};

const getJsonSize = (value: JsonValue): number => {
  if (value === undefined) {
    return getByteLength("undefined");
  }

  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string") {
      return getByteLength(serialized);
    }
  } catch {
    // Fallback to string coercion below when JSON serialization fails
  }

  return getByteLength(String(value));
};

interface JsonViewProps {
  data: unknown;
  name?: string;
  initialExpandDepth?: number;
  className?: string;
  withCopyButton?: boolean;
  isError?: boolean;
}

const JsonView = memo(
  ({
    data,
    name,
    initialExpandDepth = 3,
    className,
    withCopyButton = true,
    isError = false,
  }: JsonViewProps) => {
    const { toast } = useToast();
    const { copied, setCopied } = useCopy();

    const normalizedData = useMemo(() => {
      return typeof data === "string"
        ? tryParseJson(data).success
          ? tryParseJson(data).data
          : data
        : data;
    }, [data]);

    const totalSize = useMemo(
      () => getJsonSize(normalizedData as JsonValue),
      [normalizedData],
    );

    const handleCopy = useCallback(() => {
      try {
        navigator.clipboard.writeText(
          typeof normalizedData === "string"
            ? normalizedData
            : JSON.stringify(normalizedData, null, 2),
        );
        setCopied(true);
      } catch (error) {
        toast({
          title: "Error",
          description: `There was an error coping result into the clipboard: ${error instanceof Error ? error.message : String(error)}`,
          variant: "destructive",
        });
      }
    }, [toast, normalizedData, setCopied]);

    return (
      <div className={clsx("p-4 border rounded relative", className)}>
        {withCopyButton && (
          <Button
            size="icon"
            variant="ghost"
            className="absolute top-2 right-2"
            onClick={handleCopy}
          >
            {copied ? (
              <CheckCheck className="size-4 dark:text-green-700 text-green-600" />
            ) : (
              <Copy className="size-4 text-foreground" />
            )}
          </Button>
        )}
        <div className="font-mono text-sm transition-all duration-300">
          <JsonNode
            data={normalizedData as JsonValue}
            name={name}
            depth={0}
            initialExpandDepth={initialExpandDepth}
            isError={isError}
            rootSize={totalSize}
            path={name ? [name] : []}
          />
        </div>
      </div>
    );
  },
);

JsonView.displayName = "JsonView";

interface JsonNodeProps {
  data: JsonValue;
  name?: string;
  depth: number;
  initialExpandDepth: number;
  isError?: boolean;
  rootSize: number;
  path: Array<string | number>;
}

const jsonIdentifierRegex = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const formatJsonPath = (segments: Array<string | number>): string => {
  let path = "$";

  for (const segment of segments) {
    if (typeof segment === "number") {
      path += `[${segment}]`;
      continue;
    }

    if (jsonIdentifierRegex.test(segment)) {
      path += `.${segment}`;
      continue;
    }

    const escapedSegment = segment.replace(/"/g, '\\"');
    path += `["${escapedSegment}"]`;
  }

  return path;
};

interface JsonNodeContextMenuProps {
  path: Array<string | number>;
  onCopyPath: (segments: Array<string | number>) => Promise<void> | void;
  children: React.ReactElement;
}

const JsonNodeContextMenu = ({
  path,
  onCopyPath,
  children,
}: JsonNodeContextMenuProps) => {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void onCopyPath(path);
          }}
        >
          Copy JSON Key Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

const JsonNode = memo(
  ({
    data,
    name,
    depth = 0,
    initialExpandDepth,
    isError = false,
    rootSize,
    path,
  }: JsonNodeProps) => {
    const { toast } = useToast();
    const [isExpanded, setIsExpanded] = useState(depth < initialExpandDepth);
    const [typeStyleMap] = useState<Record<string, string>>({
      number: "text-blue-600",
      boolean: "text-amber-600",
      null: "text-purple-600",
      undefined: "text-gray-600",
      string: "text-green-600 group-hover:text-green-500",
      error: "text-red-600 group-hover:text-red-500",
      default: "text-gray-700",
    });
    const dataType = getDataType(data);
    const nodeSize = useMemo(() => getJsonSize(data), [data]);
    const formattedSize = useMemo(() => formatBytes(nodeSize), [nodeSize]);
    const percentageOfRoot = useMemo(
      () => (rootSize > 0 ? (nodeSize / rootSize) * 100 : 0),
      [nodeSize, rootSize],
    );
    const formattedPercentage = useMemo(
      () => formatPercentage(percentageOfRoot),
      [percentageOfRoot],
    );
    const sizeDetails = useMemo(
      () => `${formattedSize} • ${formattedPercentage}`,
      [formattedSize, formattedPercentage],
    );
    const shouldHighlight =
      depth > 0 &&
      rootSize > 5000 &&
      dataType === "object" &&
      percentageOfRoot >= 50;

    const [copied, setCopied] = useState(false);
    useEffect(() => {
      let timeoutId: NodeJS.Timeout;
      if (copied) {
        timeoutId = setTimeout(() => setCopied(false), 500);
      }
      return () => {
        if (timeoutId) clearTimeout(timeoutId);
      };
    }, [copied]);

    const currentPath = useMemo(() => {
      if (path.length > 0) {
        return path;
      }

      return name !== undefined ? [name] : [];
    }, [name, path]);

    const handleCopyValue = useCallback(
      async (value: JsonValue) => {
        try {
          let text: string;
          const valueType = getDataType(value);
          switch (valueType) {
            case "string":
              text = value as unknown as string;
              break;
            case "number":
            case "boolean":
              text = String(value);
              break;
            case "null":
              text = "null";
              break;
            case "undefined":
              text = "undefined";
              break;
            default:
              text = JSON.stringify(value);
          }
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch (error) {
          toast({
            title: "Error",
            description: `There was an error coping result into the clipboard: ${error instanceof Error ? error.message : String(error)}`,
            variant: "destructive",
          });
        }
      },
      [toast],
    );

    const handleCopyPath = useCallback(
      async (segments: Array<string | number>) => {
        try {
          const formattedPath = formatJsonPath(segments);
          await navigator.clipboard.writeText(formattedPath);
          toast({
            title: "Copied JSON Key Path",
            description: formattedPath,
          });
        } catch (error) {
          toast({
            title: "Error",
            description: `There was an error coping result into the clipboard: ${error instanceof Error ? error.message : String(error)}`,
            variant: "destructive",
          });
        }
      },
      [toast],
    );

    const renderCollapsible = (isArray: boolean) => {
      const items = isArray
        ? (data as JsonValue[])
        : Object.entries(data as Record<string, JsonValue>);
      const itemCount = items.length;
      const isEmpty = itemCount === 0;

      const symbolMap = {
        open: isArray ? "[" : "{",
        close: isArray ? "]" : "}",
        collapsed: isArray ? "[ ... ]" : "{ ... }",
        empty: isArray ? "[]" : "{}",
      };

      if (isEmpty) {
        return (
          <JsonNodeContextMenu path={currentPath} onCopyPath={handleCopyPath}>
            <div
              className={clsx(
                "flex items-center rounded px-1 py-0.5",
                shouldHighlight &&
                  "border border-red-200/80 bg-red-50/70 dark:border-red-900 dark:bg-red-950/40",
              )}
            >
              {name && (
                <span className="mr-1 text-gray-600 dark:text-gray-400">
                  {name}:
                </span>
              )}
              <span className="text-gray-500">{symbolMap.empty}</span>
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {sizeDetails}
              </span>
            </div>
          </JsonNodeContextMenu>
        );
      }

      return (
        <JsonNodeContextMenu path={currentPath} onCopyPath={handleCopyPath}>
          <div
            className={clsx(
              "flex flex-col rounded-md",
              shouldHighlight &&
                "border border-red-200/80 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30",
            )}
          >
            <div
              className={clsx(
                "flex items-center mr-1 rounded cursor-pointer group hover:bg-gray-800/10 dark:hover:bg-gray-800/20 px-1 py-0.5",
                shouldHighlight &&
                  "bg-red-100/60 hover:bg-red-200/60 dark:bg-red-900/40 dark:hover:bg-red-900/60",
              )}
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {name && (
                <span className="mr-1 text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-100 group-hover:text-gray-400">
                  {name}:
                </span>
              )}
              <span className="text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-100 group-hover:text-gray-400">
                {isExpanded ? symbolMap.open : symbolMap.collapsed}
              </span>
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {itemCount} {itemCount === 1 ? "item" : "items"} • {sizeDetails}
              </span>
            </div>
            {isExpanded && (
              <>
                <div
                  className={clsx(
                    "pl-2 ml-4 border-l",
                    shouldHighlight
                      ? "border-red-200/80 dark:border-red-900"
                      : "border-gray-200 dark:border-gray-800",
                  )}
                >
                  {isArray
                    ? (items as JsonValue[]).map((item, index) => (
                        <div key={index} className="my-1">
                          <JsonNode
                            data={item}
                            name={`${index}`}
                            depth={depth + 1}
                            initialExpandDepth={initialExpandDepth}
                            rootSize={rootSize}
                            path={[...currentPath, index]}
                          />
                        </div>
                      ))
                    : (items as [string, JsonValue][]).map(([key, value]) => (
                        <div key={key} className="my-1">
                          <JsonNode
                            data={value}
                            name={key}
                            depth={depth + 1}
                            initialExpandDepth={initialExpandDepth}
                            rootSize={rootSize}
                            path={[...currentPath, key]}
                          />
                        </div>
                      ))}
                </div>
                <div className="text-gray-600 dark:text-gray-400">
                  {symbolMap.close}
                </div>
              </>
            )}
          </div>
        </JsonNodeContextMenu>
      );
    };

    const renderString = (value: string) => {
      const maxLength = 100;
      const isTooLong = value.length > maxLength;

      if (!isTooLong) {
        return (
          <JsonNodeContextMenu path={currentPath} onCopyPath={handleCopyPath}>
            <div className="flex items-start gap-2 mr-1 rounded hover:bg-gray-800/20 group">
              {name && (
                <span className="mr-1 text-gray-600 dark:text-gray-400">
                  {name}:
                </span>
              )}
              <pre
                className={clsx(
                  isError ? typeStyleMap.error : typeStyleMap.string,
                  "break-all whitespace-pre-wrap",
                )}
              >
                "{value}"
              </pre>
              <span className="self-center text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {sizeDetails}
              </span>
              <Button
                variant="ghost"
                className="ml-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  void handleCopyValue(value as unknown as JsonValue);
                }}
                aria-label={name ? `Copy value of ${name}` : "Copy value"}
                title={name ? `Copy value of ${name}` : "Copy value"}
              >
                {copied ? (
                  <CheckCheck className="size-4 dark:text-green-700 text-green-600" />
                ) : (
                  <Copy className="size-4 text-foreground" />
                )}
              </Button>
            </div>
          </JsonNodeContextMenu>
        );
      }

      return (
        <JsonNodeContextMenu path={currentPath} onCopyPath={handleCopyPath}>
          <div className="flex items-start gap-2 mr-1 rounded group hover:bg-gray-800/20">
            {name && (
              <span className="mr-1 text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-100 group-hover:text-gray-400">
                {name}:
              </span>
            )}
            <pre
              className={clsx(
                isError ? typeStyleMap.error : typeStyleMap.string,
                "cursor-pointer break-all whitespace-pre-wrap",
              )}
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Click to collapse" : "Click to expand"}
            >
              {isExpanded ? `"${value}"` : `"${value.slice(0, maxLength)}..."`}
            </pre>
            <span className="self-center text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {sizeDetails}
            </span>
            <Button
              variant="ghost"
              className="ml-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation();
                void handleCopyValue(value as unknown as JsonValue);
              }}
              aria-label={name ? `Copy value of ${name}` : "Copy value"}
              title={name ? `Copy value of ${name}` : "Copy value"}
            >
              {copied ? (
                <CheckCheck className="size-4 dark:text-green-700 text-green-600" />
              ) : (
                <Copy className="size-4 text-foreground" />
              )}
            </Button>
          </div>
        </JsonNodeContextMenu>
      );
    };

    switch (dataType) {
      case "object":
      case "array":
        return renderCollapsible(dataType === "array");
      case "string":
        return renderString(data as string);
      default:
        return (
          <JsonNodeContextMenu path={currentPath} onCopyPath={handleCopyPath}>
            <div className="flex items-center gap-2 mr-1 rounded hover:bg-gray-800/20 group">
              {name && (
                <span className="mr-1 text-gray-600 dark:text-gray-400">
                  {name}:
                </span>
              )}
              <span className={typeStyleMap[dataType] || typeStyleMap.default}>
                {data === null ? "null" : String(data)}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {sizeDetails}
              </span>
              <Button
                variant="ghost"
                className="ml-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  void handleCopyValue(data as JsonValue);
                }}
                aria-label={name ? `Copy value of ${name}` : "Copy value"}
                title={name ? `Copy value of ${name}` : "Copy value"}
              >
                {copied ? (
                  <CheckCheck className="size-4 dark:text-green-700 text-green-600" />
                ) : (
                  <Copy className="size-4 text-foreground" />
                )}
              </Button>
            </div>
          </JsonNodeContextMenu>
        );
    }
  },
);

JsonNode.displayName = "JsonNode";

export default JsonView;
