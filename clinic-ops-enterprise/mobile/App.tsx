/**
 * Clinic Ops Agent - Mobile App
 * React Native cross-platform app for iOS and Android
 * Features: Claims tracking, notifications, analytics, secure messaging
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Alert,
  StatusBar,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotifications } from './hooks/useNotifications';
import { useAuth } from './hooks/useAuth';
import { APIClient } from './services/api';
import { theme } from './theme';

// ==================== TYPES ====================

interface Claim {
  id: string;
  patientName: string;
  procedure: string;
  amount: number;
  status: 'pending' | 'submitted' | 'approved' | 'denied' | 'appealed';
  submittedDate: string;
  payer: string;
  denialReason?: string;
}

interface DashboardStats {
  totalClaims: number;
  pendingClaims: number;
  approvedThisMonth: number;
  deniedThisMonth: number;
  revenueCollected: number;
  avgProcessingDays: number;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'claim_update' | 'payment' | 'alert' | 'system';
  timestamp: string;
  read: boolean;
  claimId?: string;
}

// ==================== API SERVICE ====================

const api = new APIClient({
  baseURL: 'https://api.clinic-ops.ai/v2',
  timeout: 30000,
});

// ==================== SCREENS ====================

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Dashboard Screen
function DashboardScreen({ navigation }: any) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const response = await api.get('/analytics/dashboard');
      setStats(response.data);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>Hello, {user?.name || 'Provider'}</Text>
          <Text style={styles.date}>{new Date().toLocaleDateString()}</Text>
        </View>

        {stats && (
          <View style={styles.statsGrid}>
            <StatCard
              title="Total Claims"
              value={stats.totalClaims}
              icon="file-document-outline"
              color={theme.colors.primary}
            />
            <StatCard
              title="Pending"
              value={stats.pendingClaims}
              icon="clock-outline"
              color={theme.colors.warning}
            />
            <StatCard
              title="Approved"
              value={stats.approvedThisMonth}
              icon="check-circle-outline"
              color={theme.colors.success}
            />
            <StatCard
              title="Denied"
              value={stats.deniedThisMonth}
              icon="close-circle-outline"
              color={theme.colors.error}
            />
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActions}>
            <QuickActionButton
              icon="plus-circle"
              label="New Claim"
              onPress={() => navigation.navigate('NewClaim')}
            />
            <QuickActionButton
              icon="magnify"
              label="Check Status"
              onPress={() => navigation.navigate('Claims')}
            />
            <QuickActionButton
              icon="chart-line"
              label="Analytics"
              onPress={() => navigation.navigate('Analytics')}
            />
            <QuickActionButton
              icon="message-text"
              label="Support"
              onPress={() => navigation.navigate('Support')}
            />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Claims</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Claims')}>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>
          <RecentClaimsList />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Claims List Screen
function ClaimsScreen({ navigation }: any) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadClaims();
  }, [filter]);

  const loadClaims = async () => {
    try {
      const params: any = { limit: 50 };
      if (filter !== 'all') {
        params.status = filter;
      }
      
      const response = await api.get('/claims', { params });
      setClaims(response.data.claims);
    } catch (error) {
      console.error('Failed to load claims:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredClaims = claims.filter(claim => {
    if (searchQuery) {
      return (
        claim.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        claim.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        claim.procedure.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return true;
  });

  const renderClaim = ({ item }: { item: Claim }) => (
    <TouchableOpacity
      style={styles.claimCard}
      onPress={() => navigation.navigate('ClaimDetail', { claimId: item.id })}
    >
      <View style={styles.claimHeader}>
        <Text style={styles.claimId}>#{item.id}</Text>
        <StatusBadge status={item.status} />
      </View>
      <Text style={styles.patientName}>{item.patientName}</Text>
      <Text style={styles.procedure}>{item.procedure}</Text>
      <View style={styles.claimFooter}>
        <Text style={styles.amount}>${item.amount.toFixed(2)}</Text>
        <Text style={styles.payer}>{item.payer}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchContainer}>
        <Icon name="magnify" size={20} color={theme.colors.gray} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search claims..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <View style={styles.filterContainer}>
        {['all', 'pending', 'submitted', 'approved', 'denied'].map((status) => (
          <TouchableOpacity
            key={status}
            style={[styles.filterButton, filter === status && styles.filterButtonActive]}
            onPress={() => setFilter(status)}
          >
            <Text style={[styles.filterText, filter === status && styles.filterTextActive]}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color={theme.colors.primary} />
      ) : (
        <FlatList
          data={filteredClaims}
          renderItem={renderClaim}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.claimsList}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Icon name="file-document-outline" size={64} color={theme.colors.gray} />
              <Text style={styles.emptyText}>No claims found</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

// Notifications Screen
function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const { registerForPushNotifications } = useNotifications();

  useEffect(() => {
    loadNotifications();
    registerForPushNotifications();
  }, []);

  const loadNotifications = async () => {
    try {
      const response = await api.get('/notifications');
      setNotifications(response.data.notifications);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await api.patch(`/notifications/${notificationId}/read`);
      setNotifications(prev =>
        prev.map(n => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const renderNotification = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.notificationCard, !item.read && styles.notificationUnread]}
      onPress={() => {
        markAsRead(item.id);
        // Navigate to related claim if applicable
      }}
    >
      <View style={styles.notificationIcon}>
        <Icon
          name={
            item.type === 'claim_update'
              ? 'file-document-outline'
              : item.type === 'payment'
              ? 'cash'
              : item.type === 'alert'
              ? 'alert-circle'
              : 'information'
          }
          size={24}
          color={theme.colors.primary}
        />
      </View>
      <View style={styles.notificationContent}>
        <Text style={styles.notificationTitle}>{item.title}</Text>
        <Text style={styles.notificationMessage}>{item.message}</Text>
        <Text style={styles.notificationTime}>
          {new Date(item.timestamp).toLocaleString()}
        </Text>
      </View>
      {!item.read && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={notifications}
        renderItem={renderNotification}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.notificationsList}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Icon name="bell-off-outline" size={64} color={theme.colors.gray} />
            <Text style={styles.emptyText}>No notifications</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// Profile Screen
function ProfileScreen({ navigation }: any) {
  const { user, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: logout },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Icon name="account" size={64} color={theme.colors.white} />
        </View>
        <Text style={styles.userName}>{user?.name || 'Provider'}</Text>
        <Text style={styles.userEmail}>{user?.email || 'provider@clinic.com'}</Text>
        <Text style={styles.orgName}>{user?.organization || 'Medical Practice'}</Text>
      </View>

      <View style={styles.menuSection}>
        <MenuItem
          icon="account-edit"
          label="Edit Profile"
          onPress={() => navigation.navigate('EditProfile')}
        />
        <MenuItem
          icon="bell-outline"
          label="Notifications"
          onPress={() => navigation.navigate('NotificationSettings')}
        />
        <MenuItem
          icon="shield-check"
          label="Security"
          onPress={() => navigation.navigate('Security')}
        />
        <MenuItem
          icon="help-circle-outline"
          label="Help & Support"
          onPress={() => navigation.navigate('Support')}
        />
        <MenuItem
          icon="file-document-outline"
          label="Privacy Policy"
          onPress={() => navigation.navigate('PrivacyPolicy')}
        />
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Icon name="logout" size={24} color={theme.colors.error} />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ==================== COMPONENTS ====================

function StatCard({ title, value, icon, color }: any) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color + '20' }]}>
        <Icon name={icon} size={24} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );
}

function QuickActionButton({ icon, label, onPress }: any) {
  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress}>
      <Icon name={icon} size={28} color={theme.colors.primary} />
      <Text style={styles.quickActionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: any = {
    pending: theme.colors.warning,
    submitted: theme.colors.info,
    approved: theme.colors.success,
    denied: theme.colors.error,
    appealed: theme.colors.purple,
  };

  return (
    <View style={[styles.badge, { backgroundColor: colors[status] || theme.colors.gray }]}>
      <Text style={styles.badgeText}>{status.toUpperCase()}</Text>
    </View>
  );
}

function MenuItem({ icon, label, onPress }: any) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <Icon name={icon} size={24} color={theme.colors.text} />
      <Text style={styles.menuItemText}>{label}</Text>
      <Icon name="chevron-right" size={24} color={theme.colors.gray} />
    </TouchableOpacity>
  );
}

function RecentClaimsList() {
  const [recentClaims, setRecentClaims] = useState<Claim[]>([]);

  useEffect(() => {
    loadRecentClaims();
  }, []);

  const loadRecentClaims = async () => {
    try {
      const response = await api.get('/claims', { params: { limit: 3 } });
      setRecentClaims(response.data.claims);
    } catch (error) {
      console.error('Failed to load recent claims:', error);
    }
  };

  if (recentClaims.length === 0) {
    return null;
  }

  return (
    <View>
      {recentClaims.map((claim) => (
        <View key={claim.id} style={styles.recentClaimItem}>
          <View style={styles.recentClaimInfo}>
            <Text style={styles.recentClaimId}>#{claim.id}</Text>
            <Text style={styles.recentClaimPatient}>{claim.patientName}</Text>
          </View>
          <StatusBadge status={claim.status} />
        </View>
      ))}
    </View>
  );
}

// ==================== MAIN APP ====================

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: string;

          switch (route.name) {
            case 'Dashboard':
              iconName = 'view-dashboard-outline';
              break;
            case 'Claims':
              iconName = 'file-document-multiple-outline';
              break;
            case 'Notifications':
              iconName = 'bell-outline';
              break;
            case 'Profile':
              iconName = 'account-outline';
              break;
            default:
              iconName = 'help-circle-outline';
          }

          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.gray,
        headerShown: false,
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Claims" component={ClaimsScreen} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar barStyle="dark-content" backgroundColor={theme.colors.background} />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainTabs} />
        {/* Additional screens would be added here */}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ==================== STYLES ====================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 20,
    paddingTop: 10,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  date: {
    fontSize: 16,
    color: theme.colors.gray,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
    gap: 10,
  },
  statCard: {
    width: '47%',
    backgroundColor: theme.colors.white,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginTop: 8,
  },
  statTitle: {
    fontSize: 14,
    color: theme.colors.gray,
    marginTop: 4,
  },
  section: {
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.text,
  },
  seeAll: {
    fontSize: 14,
    color: theme.colors.primary,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickAction: {
    width: '22%',
    alignItems: 'center',
    padding: 12,
  },
  quickActionLabel: {
    fontSize: 12,
    color: theme.colors.text,
    marginTop: 4,
    textAlign: 'center',
  },
  recentClaimItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.white,
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  recentClaimInfo: {
    flex: 1,
  },
  recentClaimId: {
    fontSize: 14,
    color: theme.colors.gray,
  },
  recentClaimPatient: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.text,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.white,
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 16,
    color: theme.colors.text,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.colors.lightGray,
  },
  filterButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  filterText: {
    fontSize: 12,
    color: theme.colors.text,
  },
  filterTextActive: {
    color: theme.colors.white,
  },
  claimsList: {
    padding: 16,
  },
  claimCard: {
    backgroundColor: theme.colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  claimHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  claimId: {
    fontSize: 14,
    color: theme.colors.gray,
  },
  patientName: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.text,
  },
  procedure: {
    fontSize: 14,
    color: theme.colors.gray,
    marginTop: 4,
  },
  claimFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  amount: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  payer: {
    fontSize: 14,
    color: theme.colors.gray,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.colors.white,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.gray,
    marginTop: 16,
  },
  notificationCard: {
    flexDirection: 'row',
    backgroundColor: theme.colors.white,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  notificationUnread: {
    backgroundColor: theme.colors.unreadBg,
  },
  notificationIcon: {
    marginRight: 12,
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  notificationMessage: {
    fontSize: 14,
    color: theme.colors.gray,
    marginTop: 4,
  },
  notificationTime: {
    fontSize: 12,
    color: theme.colors.gray,
    marginTop: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
    marginLeft: 8,
    alignSelf: 'center',
  },
  notificationsList: {
    flexGrow: 1,
  },
  profileHeader: {
    alignItems: 'center',
    padding: 32,
    backgroundColor: theme.colors.primary,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.white,
  },
  userEmail: {
    fontSize: 16,
    color: theme.colors.white + 'CC',
    marginTop: 4,
  },
  orgName: {
    fontSize: 14,
    color: theme.colors.white + 'AA',
    marginTop: 4,
  },
  menuSection: {
    marginTop: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.white,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text,
    marginLeft: 16,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 20,
    padding: 16,
    backgroundColor: theme.colors.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  logoutText: {
    fontSize: 16,
    color: theme.colors.error,
    marginLeft: 8,
    fontWeight: '600',
  },
});
