use async_trait::async_trait;
use serde_json::Value;

/// Context passed to builtin tools during execution.
/// This struct holds references to the concrete service dependencies.
/// It remains in the infrastructure layer (tool_registry.rs) and is
/// re-exported here as a type alias for trait ergonomics.
pub use crate::tool_registry::ToolContext;

#[async_trait]
pub trait BuiltinTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> Value;
    fn execute(&self, args: &Value, ctx: &ToolContext) -> String;
}
