use crate::services::memory_srv::SharedIndexer;

pub fn spawn_indexer_worker(indexer: SharedIndexer) {
    std::thread::spawn(move || {
        println!("[WORKER] Starting background vault reindex...");
        match indexer.reindex_all() {
            Ok((def, obs)) => {
                println!(
                    "[WORKER] Background reindex complete: default={}, obsidian={}",
                    def, obs
                );
            }
            Err(e) => {
                eprintln!("[WORKER] Background reindex error: {e}");
            }
        }
    });
}
