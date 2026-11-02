import {SIDECHAIN_WORKLET_SOURCE} from '@banger/engine';
export function GET(){return new Response(SIDECHAIN_WORKLET_SOURCE,{headers:{'Content-Type':'text/javascript','Cache-Control':'public, max-age=3600'}});}
