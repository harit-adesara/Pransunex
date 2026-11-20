import 'offline_hazard_report.dart';
import 'offline_report_store.dart';
import 'offline_sync_manager.dart';

class GiriDrishtiOfflineServices {
  final OfflineReportStore store;
  final OfflineSyncManager sync;

  GiriDrishtiOfflineServices._(this.store, this.sync);

  factory GiriDrishtiOfflineServices({required GiriDrishtiSyncApi api}) {
    final store = OfflineReportStore();
    return GiriDrishtiOfflineServices._(store, OfflineSyncManager(store: store, api: api));
  }

  Future<void> start() => sync.start();
  Future<void> dispose() => sync.stop();
  Future<List<OfflineHazardReport>> reports() => store.all();
  Future<int> pendingCount() => store.pendingCount();
}
