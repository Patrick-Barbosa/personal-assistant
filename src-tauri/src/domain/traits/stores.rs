use crate::domain::errors::DomainError;
use crate::domain::models::{InboxItem, Message, Session};
use async_trait::async_trait;

#[async_trait]
pub trait SessionStore: Send + Sync {
    fn create_session(&self, id: Option<&str>, title: &str) -> Result<Session, DomainError>;
    fn list_sessions(&self) -> Result<Vec<Session>, DomainError>;
    fn get_session(&self, session_id: &str) -> Result<Option<Session>, DomainError>;
    fn rename_session(&self, session_id: &str, new_title: &str) -> Result<bool, DomainError>;
    fn delete_session(&self, session_id: &str) -> Result<bool, DomainError>;
}

#[async_trait]
pub trait MessageStore: Send + Sync {
    fn add_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_call_id: Option<&str>,
        tool_calls: Option<&str>,
        tokens: Option<i64>,
        parent_id: Option<i64>,
    ) -> Result<Message, DomainError>;
    fn get_messages(&self, session_id: &str) -> Result<Vec<Message>, DomainError>;
    fn delete_message(&self, message_id: i64) -> Result<bool, DomainError>;
    fn truncate_messages_from(&self, session_id: &str, from_id: i64) -> Result<usize, DomainError>;
}

#[async_trait]
pub trait InboxStore: Send + Sync {
    fn insert_inbox_item(&self, item: &InboxItem) -> Result<(), DomainError>;
    fn list_inbox_items(
        &self,
        status: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<InboxItem>, DomainError>;
    fn get_inbox_item(&self, id: &str) -> Result<Option<InboxItem>, DomainError>;
    fn update_inbox_status(
        &self,
        id: &str,
        status: &str,
        decision_reason: Option<&str>,
    ) -> Result<bool, DomainError>;
    fn delete_inbox_item(&self, id: &str) -> Result<bool, DomainError>;
    fn get_unread_inbox_count(&self) -> Result<i64, DomainError>;
}

#[async_trait]
pub trait SettingsStore: Send + Sync {
    fn get_setting(&self, key: &str) -> Result<Option<String>, DomainError>;
    fn set_setting(&self, key: &str, value: &str) -> Result<(), DomainError>;
}
