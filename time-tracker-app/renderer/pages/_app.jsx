import '../styles/globals.css';
import { Provider } from 'react-redux';
import store from '../store/store';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { clearProjects } from '../store/projectSlice';
import { setComment, setTrackerStartTime, removeAllTimeLog } from '../store/timelog';
import Layout from '../components/Layout/Layout';

function MyApp({ Component, pageProps }) {
  const router = useRouter();

  useEffect(() => {
    // Clear projects when app starts to ensure no persistence
    store.dispatch(clearProjects());
  }, []);

  // Dev-only: preview the tracking screen without starting a real session.
  // In the auto-opened DevTools console: previewRunning()  →  exitPreview() when done.
  // (No backend session is started; a screenshot would only auto-fire after 5+ min,
  //  so run exitPreview() before then — and don't click the header pause button.)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    window.previewRunning = (comment = 'Sample comment for previewing the tracking screen') => {
      store.dispatch(setComment({
        comment,
        sprintId: 'preview', taskId: 'preview', projectId: 'preview',
        taskName: 'Preview task — tracking screen layout',
        projectName: 'Project Management', folderName: 'AHE', sprintName: 'Sprint 1',
        taskTypeImage: '',
      }));
      store.dispatch(setTrackerStartTime('preview'));
      router.push('/trackerRunning');
    };
    window.exitPreview = () => { store.dispatch(removeAllTimeLog()); router.push('/home'); };
  }, [router]);

  return (
    <Provider store={store}>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </Provider>
  );
}

export default MyApp;