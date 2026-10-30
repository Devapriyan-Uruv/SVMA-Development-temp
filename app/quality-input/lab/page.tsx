import {Suspense} from 'react';
import {ParameterEntryBoard} from '@/components/ParameterEntryBoard';
export default function QualityLab(){return <Suspense><ParameterEntryBoard scope="quality" kind="quality" mode="hourly" title="Quality QC Sheet Entry" subtitle="Choose a product and hour. Enter each result, or choose NA and give a reason."/></Suspense>}
